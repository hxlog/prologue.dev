import siteMetadata from "../../data/sitemetadata";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { cacheLife } from "next/cache";

/**
 * Open-source portfolio for /about.
 *
 * data/projects.yaml is the hand-written list (repo, display name, blurb); the
 * GitHub API supplies the live stars/forks. The whole read is a 'use cache'
 * scope with cacheLife("days"): the about page is prerendered, and fetching
 * GitHub per request would make it dynamic for numbers that move a few times a
 * week. A failed or rate-limited API call degrades to the YAML's stars/forks
 * (0 when absent) instead of failing the build — the portfolio is decoration,
 * never a build gate.
 *
 * Order is what the brief asked for: weighted by stars + forks. Equal weights,
 * so the score is simply the sum; ties fall back to stars, then name.
 */

const API = "https://api.github.com/repos/";
const TIMEOUT_MS = 4000;

export async function getProjects() {
  "use cache";
  cacheLife("days");

  const raw = await readFile(
    path.join(process.cwd(), "data", "projects.yaml"),
    "utf8"
  );
  const list = parse(raw)?.projects;
  if (!Array.isArray(list)) return [];

  const projects = await Promise.all(
    list
      .filter((entry) => entry && typeof entry.repo === "string")
      .map(async (entry) => {
        const fallback = {
          repo: entry.repo,
          name: entry.name || entry.repo,
          description: entry.description || "",
          stars: numberOrZero(entry.stars),
          forks: numberOrZero(entry.forks),
          language: "",
          url: "https://github.com/" + entry.repo,
        };
        const stats = await fetchStats(entry.repo);
        return { ...fallback, ...stats };
      })
  );

  return projects.sort(
    (a, b) =>
      b.stars + b.forks - (a.stars + a.forks) ||
      b.stars - a.stars ||
      a.name.localeCompare(b.name)
  );
}

async function fetchStats(repo) {
  try {
    const response = await fetch(API + repo, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${siteMetadata.siteRepo}-portfolio`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return {};
    const data = await response.json();
    return {
      stars: numberOrZero(data.stargazers_count),
      forks: numberOrZero(data.forks_count),
      language: data.language || "",
    };
  } catch {
    // Offline, rate-limited or timed out: keep the YAML numbers.
    return {};
  }
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : Number(value) || 0;
}
