/* global Ti */

import KarmaClient from 'titanium-karma-client';

import clientOptions from './config';

const win = Ti.UI.createWindow({
	backgroundColor: '#00aec8'
});
const container = Ti.UI.createView({
	layout: 'vertical',
	height: Ti.UI.SIZE
});
const titleLabel = Ti.UI.createLabel({
	text: 'Titanium Karma Client',
	color: 'white',
	font: {
		fontSize: 32
	},
	top: 0
});
container.add(titleLabel);
const statusLabel = Ti.UI.createLabel({
	text: 'Waiting ...',
	color: '#aee5ed',
	top: 10
});
container.add(statusLabel);
win.add(container);
win.open();

const baseUrl = clientOptions.url;

global.wrappers = {};

const client = new KarmaClient(baseUrl);
client.connect();
client.on('execute', () => statusLabel.text = 'Loading files ...');
client.on('result', e => statusLabel.text = `Running tests (${e.completed} / ${e.total})`);
client.on('complete', e => {
	let resultMessage = `Executed ${e.total - e.skipped} / ${e.total}`;
	if (e.failed) {
		resultMessage += ` (${e.failed} FAILED)`;
	}
	resultMessage += ' - DONE';
	statusLabel.text = resultMessage;
});
