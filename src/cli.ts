import { loadConfig } from "./config";
import { ConfluenceClient } from "./confluenceClient";
import { readManifest } from "./manifest";
import { pull } from "./pull";
import { push } from "./push";
import { getStatus, printStatus } from "./status";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || args.includes("--help")) return usage();
  const contentDir = process.env.CONFLUENCE_SYNC_CONTENT_DIR;
  const config = loadConfig(contentDir);
  const client = new ConfluenceClient(config);
  if (command === "pull") {
    const dryRun = args.includes("--dry-run");
    const trashFlag = args.includes("--trash") || process.env.PULL_TRASH_DELETED === "1";
    const result = await pull(config, client, { prune: trashFlag, dryRun });
    const deletionCount = result.manifest.deletions?.length || 0;
    const deletionMsg = deletionCount ? `, ${deletionCount} deletion(s) detected` : "";
    const trashMsg = trashFlag && !dryRun ? " and moved to trash" : trashFlag && dryRun ? " (dry-run, not moved)" : "";
    console.log(`Pull complete: ${result.manifest.items.length} item(s), ${result.manifest.warnings.length} warning(s)${deletionMsg}${trashMsg}.`);
  } else if (command === "status") {
    printStatus(await getStatus(config.contentDir, readManifest(config.contentDir), client));
  } else if (command === "push") {
    const manifest = readManifest(config.contentDir);
    const changes = await getStatus(config.contentDir, manifest, client);
    printStatus(changes);
    await push(config, manifest, changes, client, args.includes("--dry-run"));
  } else throw new Error(`Unknown command: ${command}`);
}

function usage(): void {
  console.log("Usage: npm run <pull|status|push> [-- --dry-run]\n\nCommands:\n  pull             Download the configured Confluence subtree\n  pull -- --trash  Move locally-stored items deleted from Confluence to the trash folder\n  pull -- --trash --dry-run  Preview which local items would be moved to trash\n                   (On Windows/PowerShell with npm run, set PULL_TRASH_DELETED=1 instead of --trash)\n  status           Compare local hashes and remote versions\n  push -- --dry-run  Preview safe upserts\n  push             Apply safe page and attachment upserts");
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
