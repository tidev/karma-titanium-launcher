# karma-titanium-launcher

[![Greenkeeper badge](https://badges.greenkeeper.io/appcelerator/karma-titanium-launcher.svg)](https://greenkeeper.io/)

> Run your unit tests inside Axway Titanium.

## Installation

Simply install this launcher as a dev dependency to your existing project:

```bash
npm i karma-titanium-launcher -D
```

This module also requires the `titanium` CLI to be installed globally in order to create temporary test projects and automatically downloading SDK versions. You can do so with:

```bash
npm i titanium -g
```

> 💡 iOS Testing Note: Version 0.7.0+ of this launcher requires Xcode 10.2 / Swift 5+. If you're still on Swift 4 use version 0.6.0 of this launcher.

## Usage

This launcher is for testing Titanium apps and native modules as well as plain JS libraries intended to run inside the Titanium runtime. It is typically used in CI to run tests on different platforms. However, it also supports an expirmental rapid TDD setup which allows you to run tests as you write your code.

### Configuring this launcher

To configure this launcher you have to create `customLaunchers` and set them in the `browsers` option in your Karma configuration.

```js
module.exports = config => {
    config.set({
        // ...
        customLaunchers: {
            ios: {
                base: 'Titanium',
                browserName: 'iPhone Simulator',
                platform: 'ios',
                sdkVersion: '8.0.0.GA'
            },
            android: {
                base: 'Titanium',
                browserName: 'Android Emulator (Nexus 5X)',
                platform: 'android',
                flags: [
                    '--device-id', 'Nexus_5X_API_27'
                ]
            }
        },
        browsers: ['android', 'ios']
    });
}
```

You can select the platform you want to test with the `platform` option. This will prepare your project for unit testing with Karma and launch the basic `titanium build -p [platform]` command.

Please refer to the following table for a full list of available options.

| Name  | Type | Description |
| --- | --- | --- |
| `platform`  | String | Specifies the target platform where your unit tests should be run.  |
| `flags` | Array | Additional flags to pass to the build command. Refer to `titanium build --help` for a list of available options.  |
| `sdkVersion` | String | The SDK version used to build the test runner. Defaults to the `<sdk-version>` of your `tiapp.xml` (only in app projects) or the currently selected SDK within the `titanium` CLI (check `ti sdk list`) |

You can also set certain global options that apply to all custom launchers you configure. Global options can be overridden by the individual launcher configuration.

```js
module.exports = config => {
    config.set({
        titanium: {
            sdkVersion: '8.0.0.GA'
        }
    });
};
```

Supported global options:

| Name  | Type | Description |
| --- | --- | --- |
| `sdkVersion` | String | The SDK version used to build the test runner. Defaults to the `<sdk-version>` of your `tiapp.xml` (only in app projects) or the currently selected SDK within the `titanium` CLI (check `ti sdk list`) |

### Example projects

For example projects that are using this launcher checkout [appcelerator/titanium-vdom](https://github.com/appcelerator/titanium-vdom), [appcelerator/titanized](https://github.com/appcelerator/titanized) or the [titanium-socketio](https://github.com/appcelerator-modules/titanium-socketio) native module.

## Contributions

Open source contributions are greatly appreciated! If you have a bugfix, improvement or new feature, please create
[an issue](https://github.com/appcelerator/karma-titanium-launcher/issues/new) first and submit a [pull request](https://github.com/appcelerator/karma-titanium-launcher/pulls/new) against master.

## Getting Help

If you have questions about unit testing your Titanium apps or libraries with Karma, feel free to reach out on Stackoverflow or the
`#helpme` channel on [TiSlack](http://tislack.org). In case you find a bug related to this library, create a [new issue](https://github.com/appcelerator/karma-titanium-launcher/issues/new)
or open a [new JIRA ticket](https://jira.appcelerator.org).

## License

Apache License, Version 2.0
