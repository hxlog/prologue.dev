import { getProjects } from "../lib/projects";

/**
 * Open-source portfolio for /about: the featured project spans the row, the
 * rest sit in a two-column grid. Same hairline card + pointer-tracked rim as
 * post cards (card-spotlight is driven by the one delegated <Spotlight /> in
 * the root layout), so the block reads as part of the site rather than as an
 * embedded GitHub widget.
 *
 * Server component: the numbers come from getProjects() ('use cache', one day),
 * nothing here ships client JS. The whole card is one external link — no nested
 * links, no stretched-link overlay to fight.
 */
export default async function Portfolio() {
  const projects = await getProjects();
  if (projects.length === 0) return null;

  const [featured, ...rest] = projects;

  return (
    <section className="not-prose mt-14" aria-labelledby="portfolio-title">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-2">
        <div>
          <p className="eyebrow">Open source</p>
          <h2
            id="portfolio-title"
            className="mt-1 text-title font-semibold tracking-tight text-foreground"
          >
            开源项目
          </h2>
        </div>
        <p className="text-xs text-faint">
          {projects.length} 个仓库 · 按 stars + forks 排序
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ProjectCard project={featured} featured />

        {rest.map((project) => (
          <ProjectCard key={project.repo} project={project} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project, featured = false }) {
  return (
    <a
      href={project.url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        "card card-interactive card-spotlight group relative flex flex-col p-5" +
        (featured ? " md:col-span-2 sm:p-6 sm:flex-row sm:items-end sm:gap-8" : "")
      }
    >
      <div className="min-w-0 flex-1">
        {featured ? <p className="eyebrow mb-1">精选</p> : null}
        <h3
          className={
            "card-title font-semibold tracking-tight text-foreground transition-colors duration-(--duration-fast) " +
            (featured ? "text-2xl leading-8 sm:text-h2" : "text-lg leading-7")
          }
        >
          {project.name}
        </h3>
        {project.description ? (
          <p
            className={
              "mt-2 text-sm leading-6 text-muted " +
              (featured ? "sm:max-w-2xl" : "line-clamp-3")
            }
          >
            {project.description}
          </p>
        ) : null}
      </div>

      <div
        className={
          "mt-auto flex items-center justify-between gap-3 pt-5 text-xs text-faint " +
          (featured ? "sm:mt-0 sm:shrink-0 sm:flex-col sm:items-end sm:gap-3 sm:pt-0" : "")
        }
      >
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
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className="h-3.5 w-3.5 text-faint transition-colors duration-(--duration-fast) group-hover:text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 14 14 6M8 6h6v6" />
          </svg>
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
