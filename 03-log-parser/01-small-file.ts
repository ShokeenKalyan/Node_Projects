
// LOG PARSER — SMALL FILE APPROACH (load everything into memory)
// ══════════════════════════════════════════════════════════════
//
// PROBLEM: Parse a structured log file, extract per-endpoint stats
// (request count, error rate, avg latency, p95 latency).
//
// APPROACH — SMALL FILE (fits in RAM):
//   fs.readFileSync → split('\n') → parse each line → aggregate stats
//   Simple and synchronous. Works fine when file size << available memory.
//   For large files (GBs), use streaming instead (see 02-large-file.ts).
//
// ── LOG FORMAT ───────────────────────────────────────────────────────
//   <ISO timestamp>  <LEVEL>  <METHOD>  <path>  <status>  <latency>ms  - <message>
//   2024-06-01T12:34:56.789Z INFO GET /api/users 200 123ms - User list retrieved
//
// ── REGEX: Named Capture Groups ──────────────────────────────────────
//   Named groups (?<name>...) make the match object self-documenting.
//   Instead of match[1], match[2] ... we get match.groups.ts, match.groups.level, etc.
//   Each group maps to one field in LogEntry.
//
//   Pattern breakdown:
//     (?<ts>\S+)           → ISO timestamp (any non-whitespace)
//     (?<level>INFO|...)   → log level, strictly typed
//     (?<method>\S+)       → HTTP verb (GET, POST, ...)
//     (?<path>\S+)         → URL path
//     (?<status>\d{3})     → 3-digit HTTP status code
//     (?<latency>\d+)ms    → latency number followed by literal "ms"
//     (?:\s+-\s+(?<msg>.*))? → optional " - message" suffix
//
// ── PARSING PIPELINE ─────────────────────────────────────────────────
//   readFileSync → split('\n') → trim/filter → parseLines() → aggregateStats()
//
//   parseLogLine returns:
//     null          → empty line or comment (#...) → skipped++
//     LogEntry      → valid line → entries.push()
//     throws Error  → malformed line → malformed.push()  (never silently dropped)
//
// ── AGGREGATION ──────────────────────────────────────────────────────
//   Key = "METHOD /path"  e.g. "GET /api/users"
//   statsMap: Map<key, EndPointStats>
//
//   Per endpoint we collect:
//     count     → total requests
//     errors    → statusCode >= 400 OR level === 'ERROR'
//     latencies → raw array, sorted once after all entries are processed
//     avgMs     → sum(latencies) / count
//     p95ms     → 95th percentile (see below)
//
// ── P95 LATENCY ──────────────────────────────────────────────────────
//   Sort latencies ascending. Pick the value at index ceil(0.95 * n) - 1.
//   Meaning: 95% of requests were faster than this value.
//   Example: latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] (n=10)
//     index = ceil(0.95 * 10) - 1 = ceil(9.5) - 1 = 10 - 1 = 9
//     p95 = sorted[9] = 100
//   Critical metric — avg hides tail latency; p95 exposes it.

const logFilePath = '03-log-parser/logfile.txt';  

import fs from 'fs';

// Example log line:
// 2024-06-01T12:34:56.789Z INFO GET /api/users 200 123ms - User list retrieved successfully
export interface LogEntry {
    timestamp: Date;
    level: 'INFO' | 'WARN' | 'ERROR';
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
    message?: string;
}

// Example Parse Result: { entries: [LogEntry, ...], malformed: ['bad line 1', 'bad line 2'], skipped: 5 }
export interface ParseResult {
    entries: LogEntry[];
    malformed: string[];
    skipped: number;
}

// Example Stats: { count: 1000, errors: 50, latencies: [123, 150, ...], avgMs: 130, p95ms: 200 }
export interface EndPointStats {
    count: number;
    errors: number;
    latencies: number[];
    avgMs: number;
    p95ms: number; // 95th percentile latency - Important metric for performance analysis as it represents the latency experienced by 95% of requests, helping to identify outliers and ensure a good user experience even under load.
}

// Named capture groups in regex for self documenting code and easier parsing
const LOG_REGEX = /^(?<ts>\S+)\s+(?<level>INFO|WARN|ERROR)\s+(?<method>\S+)\s+(?<path>\S+)\s+(?<status>\d{3})\s+(?<latency>\d+)ms(?:\s+-\s+(?<msg>.*))?$/;

// Parse a single log line into a LogEntry object, or return null for empty lines and comments. Throws an error for malformed lines.
export function parseLogLine(line: string): LogEntry | null {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
        return null; // Skip empty lines and comments
    }

    const match = trimmedLine.match(LOG_REGEX);
    if (!match || !match.groups) {
        throw new Error(`Malformed log line: ${trimmedLine}`);
    }

    const { ts, level, method, path, status, latency, msg } = match.groups;

    return {
        timestamp: new Date(ts),
        level: level as 'INFO' | 'WARN' | 'ERROR',
        method: method,
        path: path,
        statusCode: parseInt(status, 10),
        latencyMs: parseInt(latency, 10),
        message: msg
    }
}

// Function to parse an array of log lines and return a ParseResult containing valid entries, malformed lines, and count of skipped lines. This is useful for small files where we can load everything into memory at once.
function parseLines(lines: string[]): ParseResult {
    const result: ParseResult = {
        entries: [],
        malformed: [],
        skipped: 0
    };

    for (const line of lines) {
        try {
            const entry = parseLogLine(line);
            if (entry === null) {
                result.skipped++;
                continue;
            }
            result.entries.push(entry);
        } catch (err) {
            result.malformed.push(line); // Collect malformed lines for analysis/reporting - Never drop
        }
    }
    return result;
}

// Aggregation function to compute stats per endpoint (method + path)
export function aggregateStats(entries: LogEntry[]): Map<string, EndPointStats> {
    const statsMap = new Map<string, EndPointStats>();

    for (const entry of entries) {
        const key = `${entry.method} ${entry.path}`;
        if (!statsMap.has(key)) {
            statsMap.set(key, {
                count: 0,
                errors: 0,
                latencies: [],
                avgMs: 0,
                p95ms: 0  
            })
        }

        const stats = statsMap.get(key)!; // Non-null assertion since we just initialized it if it didn't exist
        stats.count++;
        stats.latencies.push(entry.latencyMs);
        if (entry.statusCode >= 400 || entry.level === 'ERROR') {
            stats.errors++;
        }
    }

    // Calculate average and 95th percentile latencies
    for (const stats of statsMap.values()) {
        stats.latencies.sort((a, b) => a - b);
        stats.avgMs = stats.latencies.reduce((sum, val) => sum + val, 0) / stats.latencies.length;
        stats.p95ms = calculateP95(stats.latencies, 95);
    }

    return statsMap;
}

// Helper function to calculate the p-th percentile from a sorted array of numbers
function calculateP95(sorted: number[], p: number): number {
    const index = Math.ceil(p / 100 * sorted.length) - 1;
    return sorted[index];
}

// Example usage:
const fileContent = fs.readFileSync(logFilePath, 'utf-8');
const logLines = fileContent.split('\n').map(line => line.trim()).filter(line => line);  // Split into lines, trim, and filter empty lines

// const logLines = [
//     '2024-06-01T12:34:56.789Z INFO GET /api/users 200 123ms - User list retrieved successfully',
//     '2024-06-01T12:35:00.123Z ERROR POST /api/login 500 50ms - Database connection failed',
//     '2024-06-01T12:35:05.456Z WARN GET /api/products 404 30ms - Product not found',
//     'Malformed log line example'
// ];

const parseResult = parseLines(logLines);
console.log('Parsed Entries:', parseResult.entries);
console.log('Malformed Lines:', parseResult.malformed);
console.log('Skipped Lines:', parseResult.skipped); 
const stats = aggregateStats(parseResult.entries);
console.log('Endpoint Stats:', stats);
