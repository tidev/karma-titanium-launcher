/* global Ti */

import KarmaClient from 'titanium-karma-client';

import clientOptions from './config';

const win = Ti.UI.createWindow({
	backgroundColor: '#00aec8'
});
const titleLabel = Ti.UI.createLabel({
	text: 'Titanium Karma Client',
	color: 'white',
	font: {
		fontSize: 32
	},
	center: {
		y: '48%'
	}
});
win.add(titleLabel);
const statusLabel = Ti.UI.createLabel({
	text: 'Waiting ...',
	color: '#aee5ed',
	center: {
		y: '52%'
	}
});
win.add(statusLabel);
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
