import { PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Board } from "./components/Board";
import { DprozLogo } from "./components/DprozLogo";
import { HelpBanner } from "./components/HelpBanner";
import { JobsIcon, ProfileIcon, QuestionsIcon } from "./components/NavIcons";
import { Onboarding } from "./components/Onboarding";
import { QuestionsPage } from "./components/QuestionsPage";
import { ProfilePage, SettingsPage } from "./components/SettingsPage";
import { UpdateIcon } from "./components/UpdateControl";
import { IconButton } from "./components/ui";
import { useResource } from "./lib/hooks";
import { useOpenQuestions } from "./lib/questions";
import { useUpdate } from "./lib/updates";

type Page = "jobs" | "questions" | "profile" | "settings";

const onMac = navigator.platform.startsWith("Mac");
const SIDEBAR_KEY = "sidebar";

function readCollapsed() {
	try {
		return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
	} catch {
		return false;
	}
}

type NavItemProps = {
	label: string;
	current: boolean;
	compact: boolean;
	badge?: number;
	onClick: () => void;
	icon: ReactNode;
};

function NavItem({ label, current, compact, badge = 0, onClick, icon }: NavItemProps) {
	return (
		<li>
			<button
				type="button"
				onClick={onClick}
				aria-current={current ? "page" : undefined}
				aria-label={badge > 0 ? `${label} (${badge})` : label}
				title={compact ? label : undefined}
				className={`pressable flat relative flex h-8 items-center gap-2 rounded-lg font-medium text-ink-2 hover:bg-(--nav-hover) aria-[current=page]:bg-(--nav-active) aria-[current=page]:text-ink ${
					compact ? "w-8 justify-center" : "w-full px-2"
				}`}
			>
				{icon}
				{!compact && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
				{badge > 0 && (
					<span
						className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] leading-none font-semibold text-white tabular-nums ${
							compact ? "absolute -top-1 -right-1" : ""
						}`}
					>
						{badge}
					</span>
				)}
			</button>
		</li>
	);
}

export function App() {
	const settings = useResource(() => window.desk.settings.get());
	const { history, questions, answer } = useOpenQuestions();
	const [page, setPage] = useState<Page>("jobs");
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const update = useUpdate();

	const toggleSidebar = () => {
		setCollapsed((current) => {
			try {
				localStorage.setItem(SIDEBAR_KEY, current ? "open" : "collapsed");
			} catch {}
			return !current;
		});
	};

	if (!settings.data) return <div className="drag-region h-full bg-canvas" />;
	if (!settings.data.onboarded) return <Onboarding onDone={settings.refresh} />;

	const toggle = (
		<IconButton label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} onClick={toggleSidebar}>
			{collapsed ? (
				<PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden />
			) : (
				<PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
			)}
		</IconButton>
	);
	const railWidth = onMac ? "w-[76px]" : "w-[56px]";

	return (
		<div className="app drag-region flex h-full bg-sunk">
			<nav
				aria-label="Sections"
				className={`flex shrink-0 flex-col pb-3 ${collapsed ? `${railWidth} items-center` : "w-[232px] px-3"}`}
			>
				{onMac && <div className="h-10 shrink-0" />}
				<div
					className={`flex h-11 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between pr-0.5 pl-2"} ${
						onMac ? "" : "mt-2"
					}`}
				>
					{!collapsed && <DprozLogo className="h-9 w-auto text-(--logo)" />}
					{toggle}
				</div>
				<ul className={`mt-4 flex flex-col gap-0.5 ${collapsed ? "items-center" : ""}`}>
					<NavItem
						label="Jobs"
						compact={collapsed}
						current={page === "jobs"}
						onClick={() => setPage("jobs")}
						icon={<JobsIcon />}
					/>
					<NavItem
						label="Questions"
						compact={collapsed}
						current={page === "questions"}
						badge={page === "questions" ? 0 : questions.length}
						onClick={() => setPage("questions")}
						icon={<QuestionsIcon />}
					/>
					<NavItem
						label="Profile settings"
						compact={collapsed}
						current={page === "profile"}
						onClick={() => setPage("profile")}
						icon={<ProfileIcon />}
					/>
				</ul>
				<div
					className={`mt-auto flex gap-1 ${collapsed ? "flex-col-reverse items-center" : "items-center justify-between px-0.5"}`}
				>
					<IconButton
						label="Settings"
						aria-current={page === "settings" ? "page" : undefined}
						className="aria-[current=page]:bg-(--nav-active) aria-[current=page]:text-ink"
						onClick={() => setPage("settings")}
					>
						<SettingsIcon size={16} strokeWidth={1.75} aria-hidden />
					</IconButton>
					<UpdateIcon update={update} />
				</div>
			</nav>

			<main className="no-drag my-1.5 mr-1.5 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas">
				<HelpBanner />
				{page === "jobs" && (
					<Board showReadyColumn={!settings.data.autoSubmit} sweepIntervalHours={settings.data.sweepIntervalHours} />
				)}
				{page === "questions" && <QuestionsPage history={history} open={questions} onAnswer={answer} />}
				{page === "profile" && <ProfilePage />}
				{page === "settings" && <SettingsPage settings={settings.data} onChange={settings.setData} update={update} />}
			</main>
		</div>
	);
}
