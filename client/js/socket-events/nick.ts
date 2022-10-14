import socket from "../socket";
import {store} from "../store";
import httpReq from "../helpers/httpReq";

socket.on("nick", function (data) {
	const network = store.getters.findNetwork(data.network);
	// eslint-disable-next-line no-console
	console.log(data.nick);

	httpReq(data.nick, "GET", "http://localhost:8080/api/v1/ping", {}, {}, (rsp, obj) => {
		// eslint-disable-next-line no-console
		console.log(obj.msg);
	});

	if (network) {
		network.nick = data.nick;
	}
});
