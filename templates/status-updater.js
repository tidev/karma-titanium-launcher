const Color = {
	Amber500: '#FFC107',
	Gray200: '#EEEEEE',
	Gray500: '#9E9E9E',
	Red: '#F44336',
	Green: '#8BC34A',
	Black: '#000000',
	White: '#FFFFFF'
};

export default class StatusUpdater {
	constructor(client, views) {
		this.statusLabel = views.statusLabel;
		this.connectionStatusView = views.connectionStatusView;
		this.connectionStatusLabel = views.connectionStatusLabel;

		const socket = client.socket;
		socket.on('connect', () => this.updateConnectionStatus('Connected', Color.Green));
		socket.on('disconnect', () => this.updateConnectionStatus('Disconnected', Color.Gray200));
		socket.on('connect_error', err => this.updateConnectionStatus(`Connection error (${err.message})`, Color.Red));
		socket.on('connect_timeout', (timeout) => this.updateConnectionStatus(`Connection timeout after ${timeout}ms`, Color.Red));
		socket.on('reconnecting', seconds => this.updateConnectionStatus(`Reconnecting in ${seconds} seconds...`, Color.Amber500));
		socket.on('reconnect', () => this.updateConnectionStatus('Connected', Color.Green));
		socket.on('reconnect_failed', () => this.updateConnectionStatus('Failed to reconnect', Color.Red));
	
		client.on('execute', () => this.updateStatus('Loading files ...'));
		client.on('result', e => this.updateStatus(`Running tests (${e.completed} / ${e.total})`));
		client.on('complete', e => {
			let resultMessage = `Executed ${e.total - e.skipped} / ${e.total}`;
			if (e.failed) {
				resultMessage += ` (${e.failed} FAILED)`;
			}
			resultMessage += ' - DONE';
			this.updateStatus(resultMessage);
		});
	}

	updateConnectionStatus(message, color) {
		this.connectionStatusView.backgroundColor = color;
		this.connectionStatusLabel.text = message;
		if (color === Color.Gray200 || color === Color.Gray500) {
			this.connectionStatusLabel.color = Color.Black;
		} else {
			this.connectionStatusLabel.color = Color.White;
		}
	}

	updateStatus(message) {
		this.statusLabel.color = Color.Gray500;
		this.statusLabel.text = message;
	}

	updateError(error) {
		this.statusLabel.color = Color.Red;
		this.statusLabel.text = error;
	}
}