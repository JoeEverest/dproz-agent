import ReactMarkdown from "react-markdown";

export function Markdown({ children }: { children: string }) {
	return (
		<div className="prose-agent selectable">
			<ReactMarkdown
				components={{
					a: ({ href, children: label }) => (
						<a href={href} target="_blank" rel="noreferrer">
							{label}
						</a>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
