import { awaitingChoice, type Question } from "@shared/application";

export type OpenQuestion = Question & { about?: { id: string; label: string } };

export const questionKey = (question: OpenQuestion) => JSON.stringify([question.about?.id ?? null, question.id]);

export function byArrival(a: OpenQuestion, b: OpenQuestion) {
	return a.askedAt.localeCompare(b.askedAt) || questionKey(a).localeCompare(questionKey(b));
}

export function questionQueue(questions: OpenQuestion[]) {
	return [...questions].sort((a, b) => Number(awaitingChoice(b)) - Number(awaitingChoice(a)) || byArrival(a, b));
}
