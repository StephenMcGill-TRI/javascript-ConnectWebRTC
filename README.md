# javascript-ConnectWebRTC
Connect peers using WebRTC from the browser

## Usage

Include in an HTML file.

```html
<script type="application/javascript" src="ConnectWebRTC.js"></script>
```

Initialize with an address and port.

```javascript
let my_net = new ConnectWebRTC(window.location.hostname, 8443);
my_net.connect();
```

Use callbacks

```javascript
my_net.on('peerEnter', function(uuid){...});
my_net.on('peerExit', function(uuid){...});
my_net.on('peerUpdate', function(uuid, msg){...});
```

Broadcast to peers

```javascript
my_net.peerChannels.forEach((ch, uuid) => {
    ch.send('hello ' + uuid);
});
```

Disconnect

```javascript
my_net.disconnect();
```
