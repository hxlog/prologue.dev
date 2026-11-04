import { getProjects } from "../lib/projects";

/**
 * Open-source portfolio for /about: one hairline card per repository, two
 * columns on wide screens. Same card language as post cards (card-spotlight is
 * driven by the single delegated <Spotlight /> in the root layout), so the block
 * reads as part of the site rather than as an embedded GitHub widget.
 *
 * Server component: the numbers come from getProjects() ('use cache', one day),
 * nothing here ships client JS. The whole card is one external link — no nested
 * links and no separate action button; the repository name under the card is the
 * visible destination.
 */
export default async function Portfolio() {
  const projects = await getProjects();
  if (projects.length === 0) return null;

  return (
    <section className="not-prose mt-14" aria-labelledby="portfolio-title">
      <header className="mb-5 border-b border-border pb-2">
        <p className="eyebrow">Open source</p>
        <h2
          id="portfolio-title"
          className="scroll-offset mt-1 text-title font-semibold tracking-tight text-foreground"
        >
          开源项目
        </h2>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <ProjectCard key={project.repo} project={project} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project }) {
  return (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card card-interactive card-spotlight flex flex-col p-5"
    >
      <div className="min-w-0 flex-1">
        <h3 className="card-title text-lg font-semibold leading-7 tracking-tight text-foreground transition-colors duration-(--duration-fast)">
          {project.name}
        </h3>
        {project.description ? (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">
            {project.description}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-xs text-faint">
        <span className="truncate font-mono text-[0.7rem]">{project.repo}</span>
        <span className="flex shrink-0 items-center gap-3">
          <Stat
            label="Stars"
            value={project.stars}
            icon={
              <path d="M10 1.8l2.35 4.76 5.25.77-3.8 3.7.9 5.23L10 13.79l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77L10 1.8Z" />
            }
          />
          <Stat
            label="Forks"
            value={project.forks}
            icon={
              <path d="M5.5 3.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Zm9 0a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5ZM5.5 10a1.75 1.75 0 1 1 0 3.5A1.75 1.75 0 0 1 5.5 10Zm9 0a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z" />
            }
          />
        </span>
      </div>
    </a>
  );
}

function Stat({ label, value, icon }) {
  return (
    <span className="inline-flex items-center gap-1">
      <svg
        viewBox="0 0 20 20"
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="currentColor"
      >
        {icon}
      </svg>
      <span className="sr-only">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}
