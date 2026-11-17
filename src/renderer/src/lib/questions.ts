import type { QuestionReply } from "@shared/application";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDeskEvent } from "./hooks";
import { byArrival, type OpenQuestion } from "./questionOrder";

export function useOpenQuestions() {
	const [history, setHistory] = useState<OpenQuestion[]>([]);
	const request = useRef(0);

	const refresh = useCallback(async () => {
		const version = ++request.current;
		const [inbox, applications] = await Promise.all([window.desk.inbox.list(), window.desk.applications.list()]);
		const fromCards = applications.flatMap((application) =>
			application.questions.map((question) => ({
				...question,
				about: { id: application.id, label: `${application.title} at ${application.company}` },
			})),
		);
		if (version === request.current) setHistory([...inbox, ...fromCards].sort(byArrival));
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useDeskEvent("inbox:changed", () => void refresh());
	useDeskEvent("applications:changed", () => void refresh());

	const answer = useCallback(
		async (question: OpenQuestion, reply: QuestionReply) => {
			if (question.about) await window.desk.applications.answer(question.about.id, question.id, reply);
			else await window.desk.inbox.answer(question.id, reply);
			await refresh();
		},
		[refresh],
	);

	const questions = history.filter((question) => !question.answer);
	return { history, questions, answer };
}
