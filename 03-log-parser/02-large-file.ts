
// LOG PARSER — LARGE FILE APPROACH (streaming, line-by-line)
// ══════════════════════════════════════════════════════════
//
// PROBLEM: The small-file approach (readFileSync + split('\n')) loads the
// entire file into memory at once. For a 10GB log file this would OOM the process.
//
// SOLUTION — STREAMING:
//   fs.createReadStream   → reads the file in chunks (default 64KB) from disk
//   readline.createInterface → reassembles chunks into complete lines
//   for await...of        → processes one line at a time, async, non-blocking
//
//   Memory in use at any point: O(1) — only the current line, never the whole file.
//
// ── WHY readline OVER Manual Chunking ────────────────────────────────
//   Raw stream chunks can split mid-line (a line boundary may fall anywhere
//   inside a 64KB chunk). readline handles the buffering and reassembly,
//   always emitting complete lines, so our parser never sees a partial log line.
//
//   crlfDelay: Infinity → treats \r\n (Windows line endings) as one line break,
//   regardless of the delay between receiving \r and \n. Safe default for cross-platform logs.
//
// ── ASYNC PIPELINE ───────────────────────────────────────────────────
//
//   fs.createReadStream(filePath)        ← disk I/O (async, OS-buffered)
//          ↓  chunks (Buffer)
//   readline.createInterface({ input })  ← reassembles chunks → lines
//          ↓  string lines (async iterator)
//   for await (const line of readLine)   ← pulls one line at a time
//          ↓
//   parseLogLine(line)                   ← same parser reused from 01-small-file.ts
//
//   `for await...of` on a readline interface works because readline implements
//   the AsyncIterable protocol — it emits 'line' events which the iterator adapts.
//
// ── SMALL FILE vs LARGE FILE ─────────────────────────────────────────
//
//   │ Aspect          │ Small file (01)          │ Large file (02)            │
//   │ Read method     │ readFileSync (sync)      │ createReadStream (async)   │
//   │ Memory usage    │ O(file size)             │ O(1) — one line at a time  │
//   │ Blocking?       │ Yes — blocks event loop  │ No — yields between lines  │
//   │ Suitable for    │ < ~100MB files           │ Any size (GBs, TBs)        │
//
// ── TRADE-OFF: entries[] still grows in memory ───────────────────────
//   This implementation streams parsing but still collects all LogEntry objects
//   into result.entries[] before aggregation. For truly massive files, the next
//   step would be to pipe each entry directly into aggregateStats() and discard it,
//   keeping only the running stats map in memory (streaming aggregation).

import * as fs from 'fs';
import * as readline from 'readline';

import { LogEntry, ParseResult, EndPointStats } from './01-small-file';
import { parseLogLine, aggregateStats } from './01-small-file';

const filePath = '03-log-parser/logfile.txt';  // Path to the log file

// Parse a single log line into a LogEntry object, or return null for empty lines and comments. Throws an error for malformed lines.
async function parseLogFile(filePath: string): Promise<ParseResult> {
    const result: ParseResult = {
        entries: [],
        malformed: [],
        skipped: 0
    };

    // Create a readline interface to read the file line by line
    const readLine = readline.createInterface({
        input: fs.createReadStream(filePath), // Stream the file line by line
        crlfDelay: Infinity // Recognize all instances of CR LF ('\r\n') as a single line break
    })

    // Read the file asynchronously line by line
    for await (const line of readLine) {
        try {
            const entry = parseLogLine(line);
            if (entry === null) {
                result.skipped++;
                continue; // Skip empty lines and comments
            }
            result.entries.push(entry);
        } catch (err) {
            result.malformed.push(line);
        }
    }

    return result;
}

async function main(): Promise<void> {
    const { entries, malformed, skipped } = await parseLogFile(filePath);
    const stats = aggregateStats(entries);
    console.log('Parsed Entries:', entries);
    console.log('Malformed Lines:', malformed);
    console.log('Skipped Lines:', skipped); 
    console.log('Endpoint Stats:', stats);
}

main().catch((err) => {
    console.error('Error parsing log file:', err);
    process.exit(1);
});
