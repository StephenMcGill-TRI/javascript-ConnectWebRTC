module.exports = {
    "env": {
        "browser": true,
        "es6": true,
    },
    "extends": "eslint:recommended",
    "rules": {
        "indent": [
            "error",
            4
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
	"no-console": ["error", { allow: ["info", "warn", "log"] }],
        "semi": [
            "error",
            "always"
        ]
    }
};
