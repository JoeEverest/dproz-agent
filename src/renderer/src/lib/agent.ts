import type { AgentState } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useDeskEvent } from "./hooks";

const idle: AgentState = { status: "idle", queued: 0, active: {}, paused: false };

export function useAgentState(): AgentState {
	const [state, setState] = useState<AgentState>(idle);
	useEffect(() => {
		void window.desk.agent.state().then(setState);
	}, []);
	useDeskEvent("agent:state", setState);
	return state;
}
