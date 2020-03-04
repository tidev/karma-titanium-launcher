'use strict';

const fs = require('fs');

exports.id = 'ti.karma';
exports.init = (logger, config, cli) => {
	[ 'build.android.copyResource', 'build.ios.copyResource' ].forEach(copyHookName => {
		cli.on(copyHookName, {
			pre: (hookData, done) => {
				const from = hookData.args[0];
				const sep = process.platform === 'win32' ? '\\\\' : '/';
				const appJsPattern = new RegExp(`Resources${sep}(${cli.argv.platform}${sep})?app.js`);
				if (appJsPattern.test(from)) {
					hookData.args[0] = '__APP_JS__';
				}

				done();
			}
		});
	});

	cli.on('cli:pre-validate', (_, done) => {
		// This is a really ugly hack to prevent the project-dir option callback
		// from overriding the already existing tiapp property on our cli object.
		// This allows us to change the tiapp properties from Karma without having
		// to touch the project's tiapp.xml on disk.
		const modulePath = require.resolve('node-titanium-sdk', { paths: [ cli.env.getSDK().path ] });
		// eslint-disable-next-line security/detect-non-literal-require
		const ti = require(modulePath);
		let tiapp = cli.tiapp;
		Object.defineProperty(cli, 'tiapp', {
			get: () => {
				return tiapp;
			},
			set: () => {}
		});

		cli.tiapp.transpile = true;

		if (__SDK_VERSION_OVERRIDE__) {
			cli.tiapp['sdk-version'] = '__SDK_VERSION__';
			// check that the Titanium SDK version is correct
			if (!ti.validateCorrectSDK(logger, config, cli, 'build')) {
				throw new cli.GracefulShutdown();
			}
		}

		const targetPlatform = cli.argv.platform;
		const socketIoRegistered = cli.tiapp.modules.some(moduleInfo => {
			return moduleInfo.id === 'ti.socketio' && moduleInfo.platform === targetPlatform;
		});
		if (!socketIoRegistered) {
			cli.tiapp.modules.push({
				id: 'ti.socketio',
				platform: targetPlatform
			});
		}

		done();
	});

	cli.on('build.pre.compile', {
		priority: 99999,
		post: (_, done) => {
			const karmaClientDestPath = '__KARMA_CLIENT_DEST__';
			if (fs.existsSync(karmaClientDestPath)) {
				return done();
			}

			fs.symlink('__KARMA_CLIENT_SRC__', karmaClientDestPath, done);
		}
	});
};
