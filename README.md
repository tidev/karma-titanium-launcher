# karma-titanium-launcher

[![Greenkeeper badge](https://badges.greenkeeper.io/appcelerator/karma-titanium-launcher.svg)](https://greenkeeper.io/)

> Run your unit tests inside Axway Titanium.

## Installation

Simply install this launcher as a dev dependency to your existing project:
```
npm i karma-titanium-launcher -D
```

This module also requires the `titanium` CLI to be installed globally in order to create temporary test projects and automatically downloading SDK versions. You can do so with:
```
npm i titanium -g
```

## Usage

This launcher is for testing Titanium apps and libraries. It is typically used in CI to run tests on different platforms. However, it also supports an expirmental rapid TDD setup which allows you to run tests as you write your code.

> ⚠️ Currently, only testing CommonJS modules is supported. Support for testing Titanium apps and native modules will follow shortly.

> ⚠️ Due to issues in our iOS runtime, unit testing with Karma is currently not possible. But don't worry, we alredy adressed those issues and you can enable your iOS custom launchers once 7.5.0 is out!

### Configuring this launcher

To configure this launcher you have to create `customLaunchers` and set them in the `browsers` option in your Karma configuration.

```
module.exports = config => {
    config.set({
        // ...
        customLaunchers: {
            // testing on iOS needs TIMOB-26184 and TIMOB-26179, which are included in 7.5.0
            ios: {
                base: 'Titanium',
                browserName: 'iPhone Simulator',
                platform: 'ios',
                sdkVersion: '7.5.0.GA'
            },
            android: {
                base: 'Titanium',
                browserName: 'Android Emulator (Nexus 5X)',
                platform: 'android',
                flags: [
                    '--device-id', 'Nexus_5X_API_27'
                ],
                sdkVersion: '7.4.0.GA'
            }
        },
        browsers: ['android']
    });
}
```

You can select the platform you want to test with the `platform` option. This will prepare your project for unit testing with Karma and launch the basic `titanium build -p [platform]` command.

Please refer to the following table for a full list of available options.

| Name  | Type | Description |
| --- | --- | --- |
| `platform`  | String | Specifies the target platform where your unit tests should be run.  |
| `flags` | Array | Additional flags to pass to the build command. Refer to `titanium build --help` for a list of available options.  |
| `sdkVersion` | String | The SDK version used to build the test runner. Defaults to the `<sdk-version>` of your `tiapp.xml` or the currently selected SDK within the `titanium` CLI |

### Example projects

For example projects that are using this launcher checkout [appcelerator/titanium-vdom](https://github.com/appcelerator/titanium-vdom) or [appcelerator/titanized](https://github.com/appcelerator/titanized).

## Contributions

Open source contributions are greatly appreciated! If you have a bugfix, improvement or new feature, please create
[an issue](https://github.com/appcelerator/karma-titanium-launcher/issues/new) first and submit a [pull request](https://github.com/appcelerator/karma-titanium-launcher/pulls/new) against master.

## Getting Help

If you have questions about unit testing your Titanium apps or libraries with Karma, feel free to reach out on Stackoverflow or the
`#helpme` channel on [TiSlack](http://tislack.org). In case you find a bug related to this library, create a [new issue](https://github.com/appcelerator/karma-titanium-launcher/issues/new)
or open a [new JIRA ticket](https://jira.appcelerator.org).

## License

Apache License, Version 2.0
