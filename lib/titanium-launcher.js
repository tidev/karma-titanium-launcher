'use strict';

var which = require('which');

function resolveBinaryPath(command) {
	return which.sync(command, { nothrow: true });
}

/**
 * Redirects logs from underlying process to our logger
 * @param {object} logger logger to redirect to
 * @param {Buffer|String} data process output/data
 */
function redirectLog(logger, data) {
	const raw = data.toString().trimEnd();
	const lines = raw.split(/\r?\n/);
	lines.forEach(l => {
		// Sniff the log levels and redirect to appropriate levels here
		const m = l.match(/^\s*\[(ERROR|INFO|DEBUG|WARN|TRACE)\]\s+(.+)$/);
		if (m) {
			const level = m[1].toLowerCase();
			logger[level](m[2]);
		} else {
			logger.debug(l); // should we trace by default?
		}
	});
}

function TitaniumLauncher(baseBrowserDecorator, projectManager, loggerFactory, config, args) {
	baseBrowserDecorator(this);

	const globalLauncherConfig = config.titanium || {};
	const platform = args.platform;
	const commandArgs = [ 'build', '-p', platform ];
	const flags = args && args.flags || [];
	const sdkVersion = args.sdkVersion || globalLauncherConfig.sdkVersion;
	const logger = loggerFactory.create('titanium');

	this.name = 'Titanium Test Runner';

	this._start = url => {
		logger.info('Preparing project for Karma test run execution ...');

		projectManager.prepareProject({
			platform,
			sdkVersion,
			tempPath: this._tempDir,
			client: {
				url,
				singleRun: config.singleRun
			}
		}).then(() => {
			logger.info('Project preparation done, starting Karma unit test runner');
			commandArgs.push(
				'-d', projectManager.karmaRunnerProjectPath,
				'--no-prompt',
				'--no-colors',
				'--no-progress-bars'
			);
			this._execCommand(this._getCommand(), commandArgs.concat(flags));

			if (config.logLevel === config.LOG_DEBUG) {
				this._process.stdout.on('data', data => redirectLog(logger, data));
				this._process.stderr.on('data', data => redirectLog(logger, data));
			}

			return;
		}).catch(err => {
			logger.error(`Failed to prepare project.\n  ${err}`);
			logger.debug(err.stack);
			this._done('failure');
		});
	};

	this.on('done', () => projectManager.undoChanges());
}

const resolvedTitaniumBinaryPath = resolveBinaryPath('titanium');

TitaniumLauncher.prototype = {
	name: 'Titanium',

	DEFAULT_CMD: {
		linux: resolvedTitaniumBinaryPath,
		darwin: resolvedTitaniumBinaryPath,
		win32: resolvedTitaniumBinaryPath
	},
	ENV_CMD: 'APPC_BIN'
};

TitaniumLauncher.$inject = [ 'baseBrowserDecorator', 'projectManager', 'logger', 'config', 'args' ];

module.exports = TitaniumLauncher;
