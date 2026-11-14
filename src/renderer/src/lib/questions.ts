import type { Question } from "@shared/application";
import { useCallback, useEffect, useState } from "react";
import { useDeskEvent } from "./hooks";

export type OpenQuestion = Question & { about?: { id: string; label: string } };

export function useOpenQuestions() {
	const [history, setHistory] = useState<OpenQuestion[]>([]);

	const refresh = useCallback(async () => {
		const [inbox, applications] = await Promise.all([window.desk.inbox.list(), window.desk.applications.list()]);
		const fromCards = applications.flatMap((application) =>
			application.questions.map((question) => ({
				...question,
				about: { id: application.id, label: `${application.title} at ${application.company}` },
			})),
		);
		setHistory([...inbox, ...fromCards].sort((a, b) => a.askedAt.localeCompare(b.askedAt)));
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);
	useDeskEvent("inbox:changed", () => void refresh());
	useDeskEvent("applications:changed", () => void refresh());

	const answer = useCallback(
		async (question: OpenQuestion, text: string) => {
			if (question.about) await window.desk.applications.answer(question.about.id, question.id, text);
			else await window.desk.inbox.answer(question.id, text);
			await refresh();
		},
		[refresh],
	);

	const questions = history.filter((question) => !question.answer);
	return { history, questions, answer };
}
