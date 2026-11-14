import help from "../assets/icons/help.svg";
import jobs from "../assets/icons/jobs.svg";
import profile from "../assets/icons/profile.svg";

const icon = (source: string) => () => (
	<img src={source} alt="" width={18} height={18} className="shrink-0" draggable={false} />
);

export const JobsIcon = icon(jobs);
export const QuestionsIcon = icon(help);
export const ProfileIcon = icon(profile);
