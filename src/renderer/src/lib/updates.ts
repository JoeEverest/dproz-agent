import type { UpdateInfo } from "@shared/ipc";
import { useEffect, useState } from "react";
import { useDeskEvent } from "./hooks";

export function useUpdate() {
	const [update, setUpdate] = useState<UpdateInfo | null>(null);
	useEffect(() => {
		void window.desk.updates.status().then(setUpdate);
	}, []);
	useDeskEvent("update:changed", setUpdate);
	return update;
}
