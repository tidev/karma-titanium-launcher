'use strict';

const fs = require('fs');

exports.id = 'ti.karma';
exports.init = (logger, config, cli) => {
	[ 'build.android.copyResource', 'build.ios.copyResource' ].forEach(copyHookName => {
		cli.on(copyHookName, {
			pre: (hookData, done) => {
				const from = hookData.args[0];
				const appJsPattern = new RegExp(`Resources\/(${cli.argv.platform}\/)?app\.js`);
				if (appJsPattern.test(from)) {
					hookData.args[0] = '__APP_JS__';
				}

				done();
			}
		});
	});

	cli.on('cli:pre-validate', (_, done) => {
		// This would be the expected approach but tiapp will be overridden
		// in the project-dir option callback, see below.
		// cli.tiapp.transpile = true;

		// Patch the project-dir option callback of the build command because it re-parses tiapp.xml
		const originalProjectDirCallback = cli.command.options['project-dir'].callback;
		cli.command.options['project-dir'].callback = function (projectDir) {
			originalProjectDirCallback.call(null, projectDir);

			cli.tiapp.transpile = true;

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
		};

		done();
	});

	cli.on('build.pre.compile', {
		priority: 99999,
		post: (_, done) => {
			fs.symlink('__KARMA_CLIENT_SRC__', '__KARMA_CLIENT_DEST__', done);
		}
	});
};
