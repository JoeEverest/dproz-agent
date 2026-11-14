import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
	return (
		<header className="drag-region flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line pr-4 pl-6">
			<h1 className="text-sm font-semibold">{title}</h1>
			{children && <div className="flex items-center gap-2">{children}</div>}
		</header>
	);
}
