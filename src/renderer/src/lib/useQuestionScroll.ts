import { useLayoutEffect, useRef, useState } from "react";

type Anchor = { key: string; offset: number };

/** Keep the reader on the same message when answers or status updates change the thread above it. */
export function useQuestionScroll() {
	const scroller = useRef<HTMLElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const anchors = useRef<Anchor[]>([]);
	const previousTop = useRef(0);
	const [away, setAway] = useState(false);

	const remember = () => {
		const element = scroller.current;
		if (!element) return;
		const top = element.getBoundingClientRect().top;
		following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
		previousTop.current = element.scrollTop;
		anchors.current = Array.from(element.querySelectorAll<HTMLElement>("[data-message]"))
			.map((message) => ({
				key: message.dataset.message ?? "",
				offset: message.getBoundingClientRect().top - top,
				bottom: message.getBoundingClientRect().bottom - top,
			}))
			.filter((message) => message.bottom > 0 && message.offset < element.clientHeight);
		setAway(!following.current);
	};

	const restore = () => {
		const element = scroller.current;
		if (!element) return;
		if (following.current) element.scrollTop = element.scrollHeight;
		else {
			const messages = Array.from(element.querySelectorAll<HTMLElement>("[data-message]"));
			const anchor = anchors.current.find((candidate) =>
				messages.some((message) => message.dataset.message === candidate.key),
			);
			const message = anchor && messages.find((message) => message.dataset.message === anchor.key);
			if (anchor && message) {
				element.scrollTop += message.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset;
			} else element.scrollTop = previousTop.current;
		}
		remember();
	};

	// Restore after every render, including composer height changes, before the browser paints.
	useLayoutEffect(restore);
	const restoreRef = useRef(restore);
	restoreRef.current = restore;
	useLayoutEffect(() => {
		const observer = new ResizeObserver(() => restoreRef.current());
		if (scroller.current) observer.observe(scroller.current);
		if (content.current) observer.observe(content.current);
		return () => observer.disconnect();
	}, []);

	const toBottom = () => {
		following.current = true;
		restore();
	};
	return { scroller, content, away, onScroll: remember, toBottom };
}
