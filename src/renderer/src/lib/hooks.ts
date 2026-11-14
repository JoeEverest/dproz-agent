import type { DeskEvents } from "@shared/ipc";
import { useCallback, useEffect, useRef, useState } from "react";

export function useDeskEvent<K extends keyof DeskEvents>(channel: K, listener: (payload: DeskEvents[K]) => void) {
	const latest = useRef(listener);
	latest.current = listener;
	useEffect(() => window.desk.on(channel, (payload) => latest.current(payload)), [channel]);
}

export function useResource<T>(load: () => Promise<T>, refreshOn: (keyof DeskEvents)[] = []) {
	const [data, setData] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const loader = useRef(load);
	loader.current = load;

	const refresh = useCallback(async () => {
		try {
			setData(await loader.current());
			setError(null);
		} catch (cause) {
			setError((cause as Error).message);
		}
	}, []);

	const channels = refreshOn.join(",");
	useEffect(() => {
		void refresh();
		const names = channels ? (channels.split(",") as (keyof DeskEvents)[]) : [];
		const unsubscribe = names.map((channel) => window.desk.on(channel, () => void refresh()));
		return () => {
			for (const stop of unsubscribe) stop();
		};
	}, [refresh, channels]);

	return { data, error, refresh, setData };
}
