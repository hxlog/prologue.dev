import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import PageTransition from "../../components/page-transition";
import { formatDate } from "../../lib/date";

export async function generateMetadata() {
  return {
    title: "微博 Microblog",
    description: "微博 Microblog",
  };
}

export default async function MicroblogPage() {
  const filePath = path.join(process.cwd(), "data", "microblog.yaml");
  const fileContent = fs.readFileSync(filePath, "utf8");
  const microblogs = load(fileContent);

  return (
    <PageTransition className="mx-auto max-w-3xl py-8">
      <p className="eyebrow">Microblog</p>
      <h1 className="mt-2 pb-8 text-3xl font-semibold tracking-tight text-foreground">
        微博
      </h1>
      {microblogs
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((microblog, index) => (
          <div
            key={`${microblog.date}-${index}`}
            className="card my-4 px-6 py-4 transition-shadow duration-200 hover:shadow-card-hover"
          >
            <time className="text-xs text-faint">
              {formatDate(microblog.date)}
            </time>
            <p className="mt-1.5 leading-7 text-foreground">{microblog.content}</p>
          </div>
        ))}
    </PageTransition>
  );
}
