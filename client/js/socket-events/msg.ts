/* eslint-disable @typescript-eslint/restrict-plus-operands */
import socket from "../socket";
import cleanIrcMessage from "../helpers/ircmessageparser/cleanIrcMessage";
import {store} from "../store";
import {switchToChannel} from "../router";
import {ClientChan, ClientMention, ClientMessage, NetChan} from "../types";
import httpReq from "../helpers/httpReq";

let pop;

try {
	pop = new Audio();
	pop.src = "audio/pop.wav";
} catch (e) {
	pop = {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		play() {},
	};
}

interface EnrolUser {
	internal: boolean;
	op_level?: string;
}

interface MsgObj {
	channel?: string;
	explicit: boolean;
	is_sender: boolean;
	jid?: string;
	msg: string;
	other_party?: string;
}

socket.on("msg", function (data) {
	/* eslint-disable no-console */
	const receivingChannel = store.getters.findChannel(data.chan);

	if (!receivingChannel) {
		return;
	}

	let channel = receivingChannel.channel;
	let isActiveChannel =
		store.state.activeChannel && store.state.activeChannel.channel === channel;

	// Display received notices and errors in currently active channel.
	// Reloading the page will put them back into the lobby window.
	if (data.msg.showInActive) {
		// We only want to put errors/notices in active channel if they arrive on the same network
		if (
			store.state.activeChannel &&
			store.state.activeChannel.network === receivingChannel.network
		) {
			channel = store.state.activeChannel.channel;

			// Do not update unread/highlight counters for this channel
			// as we are putting this message in the active channel
			isActiveChannel = true;

			if (data.chan === channel.id) {
				// If active channel is the intended channel for this message,
				// remove the showInActive flag
				delete data.msg.showInActive;
			} else {
				data.chan = channel.id;
			}
		} else {
			delete data.msg.showInActive;
		}
	}

	let jid = "";

	if (/[0-9][A-z][A-z][0-9][0-9][A-z]/.test(data.msg.text)) {
		const arr = /[0-9][A-z][A-z][0-9][0-9][A-z]/.exec(data.msg.text);

		if (arr) {
			jid = arr[0].toUpperCase();
		}
	}

	// JOTI API INTEGRATION
	if (data.msg.type === "message") {
		const usrNick = receivingChannel.network.nick;
		const obj: MsgObj = {
			channel: channel.name.startsWith("#") ? channel.name : undefined,
			explicit: data.msg.text.includes("__"),
			is_sender: data.msg.self,
			jid: jid === "" ? undefined : jid,
			msg: data.msg.text,
			other_party:
				data.msg.from.nick !== usrNick || channel.name === usrNick
					? data.msg.from.nick
					: undefined,
		};

		httpReq(usrNick, "POST", "http://10.0.4.102:8080/api/v1/message", obj, {}, undefined);

		// console.log(receivingChannel);
		// console.log(data);
		// console.log(obj);
	} else if (
		data.msg.type === "join" &&
		data.msg.from.nick &&
		data.msg.from.nick === receivingChannel.network.nick
	) {
		// console.log(data);

		const obj: EnrolUser = {
			internal: true,
		};
		httpReq(
			data.msg.from.nick,
			"POST",
			"http://10.0.4.102:8080/api/v1/user",
			obj,
			{},
			(didRsp, rsp) => {
				console.log(rsp);
			}
		);
	}

	// Do not set unread counter for channel if it is currently active on this client
	// It may increase on the server before it processes channel open event from this client
	if (!isActiveChannel) {
		if (typeof data.highlight !== "undefined") {
			channel.highlight = data.highlight;
		}

		if (typeof data.unread !== "undefined") {
			channel.unread = data.unread;
		}
	}

	channel.messages.push(data.msg);

	if (data.msg.self) {
		channel.firstUnread = data.msg.id;
	} else {
		notifyMessage(data.chan, channel, store.state.activeChannel, data.msg);
	}

	let messageLimit = 0;

	if (!isActiveChannel) {
		// If message arrives in non active channel, keep only 100 messages
		messageLimit = 100;
	} else if (channel.scrolledToBottom) {
		// If message arrives in active channel, keep 1500 messages if scroll is currently at the bottom
		// One history load may load up to 1000 messages at once if condendesed or hidden events are enabled
		messageLimit = 1500;
	}

	if (messageLimit > 0 && channel.messages.length > messageLimit) {
		channel.messages.splice(0, channel.messages.length - messageLimit);
		channel.moreHistoryAvailable = true;
	}

	if (channel.type === "channel") {
		updateUserList(channel, data.msg);
	}
	/* eslint-enable no-console */
});

function notifyMessage(
	targetId: number,
	channel: ClientChan,
	activeChannel: NetChan | undefined,
	msg: ClientMessage
) {
	if (channel.muted) {
		return;
	}

	if (msg.highlight || (store.state.settings.notifyAllMessages && msg.type === "message")) {
		if (!document.hasFocus() || !activeChannel || activeChannel.channel !== channel) {
			if (store.state.settings.notification) {
				try {
					pop.play();
				} catch (exception) {
					// On mobile, sounds can not be played without user interaction.
				}
			}

			if (
				store.state.settings.desktopNotifications &&
				"Notification" in window &&
				Notification.permission === "granted"
			) {
				let title: string;
				let body: string;

				if (msg.type === "invite") {
					title = "New channel invite:";
					body = msg.from.nick + " invited you to " + msg.channel;
				} else {
					title = String(msg.from.nick);

					if (channel.type !== "query") {
						title += ` (${channel.name})`;
					}

					if (msg.type === "message") {
						title += " says:";
					}

					body = cleanIrcMessage(msg.text);
				}

				const timestamp = Date.parse(String(msg.time));

				try {
					if (store.state.hasServiceWorker) {
						navigator.serviceWorker.ready
							.then((registration) => {
								registration.active?.postMessage({
									type: "notification",
									chanId: targetId,
									timestamp: timestamp,
									title: title,
									body: body,
								});
							})
							.catch(() => {
								// no-op
							});
					} else {
						const notify = new Notification(title, {
							tag: `chan-${targetId}`,
							badge: "img/icon-alerted-black-transparent-bg-72x72px.png",
							icon: "img/icon-alerted-grey-bg-192x192px.png",
							body: body,
							timestamp: timestamp,
						});
						notify.addEventListener("click", function () {
							this.close();
							window.focus();

							const channelTarget = store.getters.findChannel(targetId);

							if (channelTarget) {
								switchToChannel(channelTarget.channel);
							}
						});
					}
				} catch (exception) {
					// `new Notification(...)` is not supported and should be silenced.
				}
			}
		}
	}
}

function updateUserList(channel, msg) {
	if (msg.type === "message" || msg.type === "action") {
		const user = channel.users.find((u) => u.nick === msg.from.nick);

		if (user) {
			user.lastMessage = new Date(msg.time).getTime() || Date.now();
		}
	} else if (msg.type === "quit" || msg.type === "part") {
		const idx = channel.users.findIndex((u) => u.nick === msg.from.nick);

		if (idx > -1) {
			channel.users.splice(idx, 1);
		}
	} else if (msg.type === "kick") {
		const idx = channel.users.findIndex((u) => u.nick === msg.target.nick);

		if (idx > -1) {
			channel.users.splice(idx, 1);
		}
	}
}
