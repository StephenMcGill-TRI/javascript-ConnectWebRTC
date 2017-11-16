// Copyright (c) 2017 Stephen McGill and Toyota Research Institute 2017
// Licensed under the MIT license. See LICENSE
/* exported ConnectWebRTC */
'use strict';

window.RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;
window.RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;

const UUID = Math.random().toString(36).substring(2);
const PEER_TIMEOUT = 1e3;
const errorHandler = console.warn;

class ConnectWebRTC {
    constructor(addr, port) {
        // WebSocker Server information
        this.addr = addr;
        this.port = port;
        this.serverConnection = null;
        // Event registrations
        this.eventsListeners = new Map();
        // Make the variables that we need
        this.peerChannels = new Map();
        this.peerConnections = new Map();
        this.peerTimeouts = new Map();
        // Interval handles
        this.h_cleanup = null;
    }

    on(evtName, fn) {
        if (typeof fn === 'function' && typeof evtName === 'string') {
            this.eventsListeners.set(evtName, fn);
        }
    }

    emit(evtName, ...args) {
        let fn = this.eventsListeners.get(evtName);
        if (typeof fn === 'function') {
            fn(...args);
        }
    }

    cleanPeer(target_uuid) {
        console.log("Closing", target_uuid);
        this.peerTimeouts.delete(target_uuid);
        let ch = this.peerChannels.get(target_uuid);
        this.peerChannels.delete(target_uuid);
        if (ch) {
            ch.close();
        }
        let conn = this.peerConnections.get(target_uuid);
        this.peerConnections.delete(target_uuid);
        if (conn) {
            conn.close();
        }
    }

    pruneAllPeers() {
        // Check the timeout
        this.peerTimeouts.forEach((timeout, target_uuid) => {
            let dt_timeout = Date.now() - timeout;
            if (dt_timeout >= PEER_TIMEOUT) {
                this.cleanPeer(target_uuid);
            }
        }, this);
    }

    disconnect() {
        console.log("Closing connection...");
        if (this.serverConnection) {
            this.serverConnection.close();
        }
    }

    connect() {
        let obj = this;
        // Open WebSocket signaling
        let serverConnection = new WebSocket('wss://' + obj.addr + ':' + obj.port);
        serverConnection.onopen = () => {
            // Signal the group in order to join
            serverConnection.send(JSON.stringify({
                'ice': false,
                'sdp': false,
                'target': false,
                'uuid': UUID
            }));
            // Cleanup other peers regularly
            obj.h_cleanup = setInterval(() => this.pruneAllPeers(), PEER_TIMEOUT);
        };
        // Closing the signaling channel
        serverConnection.onclose = () => {
            // Leave all the connections
            obj.peerChannels.forEach((ch) => { ch.close(); });
            obj.peerConnections.forEach((conn) => { conn.close(); });
            clearInterval(obj.h_cleanup);
        };
        // Messages from the signaling channel
        serverConnection.onmessage = (msg) => {
            let signal = JSON.parse(msg.data);
            // Ignore our own requests and ones not targeted for us
            if (signal.uuid == UUID) {
                return false;
            } else if (signal.target && signal.target != UUID) {
                return false;
            }
            obj.establishPeer(signal);
        };
        // Bookkeeping
        obj.serverConnection = serverConnection;
        return serverConnection;
    }

    establishPeer(signal) {
        let obj = this;
        let peerConnection = obj.peerConnections.get(signal.uuid);
        // Check if we must initialize this peer connection
        if (!peerConnection) {
            console.info("Initializing peer", signal.uuid);
            peerConnection = obj.init_peer_connection(signal.uuid);
            obj.peerConnections.set(signal.uuid, peerConnection);
            obj.init_data_connection(signal.uuid, peerConnection);
            obj.peerTimeouts.set(signal.uuid, Date.now());
        }
        if (signal.ice) {
            console.info("Add ICE candidate for", signal.uuid, peerConnection);
            let candidate = new RTCIceCandidate(signal.ice);
            peerConnection.addIceCandidate(candidate).catch(errorHandler);
            return;
        }
        // Setup a connection for this UUID by making an offer
        if (!signal.sdp) {
            console.info("Offer connection to", signal.uuid);
            // createOffer generates an SDP
            peerConnection.createOffer()
                .then((description) => peerConnection.setLocalDescription(description))
                .then(() => obj.serverConnection.send(JSON.stringify({
                    'ice': false,
                    'sdp': peerConnection.localDescription,
                    'target': signal.uuid,
                    'uuid': UUID,
                })))
                .catch(errorHandler);
            return;
        }
        // Set remote description based on information from the peer
        let description = signal.sdp; // Effectively an RTCSessionDescription object
        console.info("SDP type [", description.type, "] from: ", signal.uuid);
        if (description.type === "offer") {
            // Only create answers in response to offers
            peerConnection.setRemoteDescription(description)
                .then(() => peerConnection.createAnswer())
                .then((description) => peerConnection.setLocalDescription(description))
                // Send Offering
                .then(() => obj.serverConnection.send(JSON.stringify({
                    'ice': false,
                    'sdp': peerConnection.localDescription,
                    'target': signal.uuid,
                    'uuid': UUID,
                })))
                .catch(errorHandler);
        } else if (description.type === "answer") {
            // TODO: Be careful in this section...
            peerConnection.setRemoteDescription(description)
                .catch(errorHandler);
        } else {
            errorHandler("Bad SDP type", signal.sdp.type);
        }
    }

    init_peer_connection(target_uuid) {
        // Make the new connection to a peer
        let obj = this;
        let peerConnection = new RTCPeerConnection({
            'iceServers': [{
                'urls': 'stun:127.0.0.1:3478'
            },]
        });
        // Check for ICE configuration messages
        peerConnection.onicecandidate = (event) => {
            if (obj.serverConnection && event.candidate) {
                console.info("Got ice candidate", event.candidate);
                obj.serverConnection.send(JSON.stringify({
                    'ice': event.candidate,
                    'sdp': false,
                    'target': false,
                    'uuid': UUID,
                }));
            }
        };
        peerConnection.oniceconnectionstatechange = () => {
            switch (peerConnection.iceConnectionState) {
            case "closed":
            case "disconnected":
                console.info("ICE closed", target_uuid);
                obj.peerConnections.delete(target_uuid);
                obj.peerChannels.delete(target_uuid);
                break;
            default:
                console.info("ICE state", peerConnection.iceConnectionState);
                break;
            }
        };
        peerConnection.ondatachannel = (event) => {
            // This is the _sending_ channel for data
            console.log("Got data channel", event, peerConnection);
            let channel = event.channel;
            channel.onopen = (e) => {
                console.log('Data channel opened for sending:', e, peerConnection);
                obj.peerChannels.set(target_uuid, channel);
            };
            channel.onclose = (e) => {
                console.log('Data channel closed for sending:', e, peerConnection);
                obj.peerChannels.delete(target_uuid);
            };
        };
        return peerConnection;
    }

    init_data_connection(target_uuid, peerConnection) {
        // Make a data channel over which we _receive_ messages
        let obj = this;
        let dc = peerConnection.createDataChannel("Guardian", {
            ordered: false,
            reliable: false,
            maxPacketLifeTime: 33,
            maxRetransmitTime: 100,
        });
        dc.onopen = () => {
            obj.emit("peerEnter", target_uuid);
        };
        dc.onclose = () => {
            obj.emit("peerExit", target_uuid);
            obj.cleanPeer(target_uuid);
        };
        dc.onmessage = (event) => {
            let msg = JSON.parse(event.data);
            obj.emit("peerUpdate", target_uuid, msg);
            obj.peerTimeouts.set(target_uuid, Date.now());
        };
        return dc;
    }
}
