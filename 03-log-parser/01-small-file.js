// Named capture groups in regex for self documenting code and easier parsing
var LOG_REGEX = /^(?<ts>\S+)\s+(?<level>INFO|WARN|ERROR)\s+(?<method>\S+)\s+(?<path>\S+)\s+(?<status>\d{3})\s+(?<latency>\d+)ms(?:\s+"(?<msg>[^"]*)")?$/;
function parseLogLine(line) {
    var trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
        return null; // Skip empty lines and comments
    }
    var match = trimmedLine.match(LOG_REGEX);
    if (!match || !match.groups) {
        throw new Error("Malformed log line: ".concat(trimmedLine));
    }
    var _a = match.groups, ts = _a.ts, level = _a.level, method = _a.method, path = _a.path, status = _a.status, latency = _a.latency, msg = _a.msg;
    return {
        timestamp: new Date(ts),
        level: level,
        method: method,
        path: path,
        statusCode: parseInt(status, 10),
        latencyMs: parseInt(latency, 10),
        message: msg
    };
}
function parseLines(lines) {
    var result = {
        entries: [],
        malformed: [],
        skipped: 0
    };
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        try {
            var entry = parseLogLine(line);
            if (entry === null) {
                result.skipped++;
                continue;
            }
            result.entries.push(entry);
        }
        catch (err) {
            result.malformed.push(line); // Collect malformed lines for analysis/reporting - Never drop
        }
    }
    return result;
}
// Aggregation function to compute stats per endpoint (method + path)
function aggregateStats(entries) {
    var statsMap = new Map();
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
        var entry = entries_1[_i];
        var key = "".concat(entry.method, " ").concat(entry.path);
        if (!statsMap.has(key)) {
            statsMap.set(key, {
                count: 0,
                errors: 0,
                latencies: [],
                avgMs: 0,
                p95ms: 0
            });
        }
        var stats_1 = statsMap.get(key); // Non-null assertion since we just initialized it if it didn't exist
        stats_1.count++;
        stats_1.latencies.push(entry.latencyMs);
        if (entry.statusCode >= 400 || entry.level === 'ERROR') {
            stats_1.errors++;
        }
    }
    // Calculate average and 95th percentile latencies
    for (var _a = 0, _b = statsMap.values(); _a < _b.length; _a++) {
        var stats_2 = _b[_a];
        stats_2.latencies.sort(function (a, b) { return a - b; });
        stats_2.avgMs = stats_2.latencies.reduce(function (sum, val) { return sum + val; }, 0) / stats_2.latencies.length;
        stats_2.p95ms = calculateP95(stats_2.latencies, 95);
    }
    return statsMap;
}
// Helper function to calculate the p-th percentile from a sorted array of numbers
function calculateP95(sorted, p) {
    var index = Math.ceil(p / 100 * sorted.length) - 1;
    return sorted[index];
}
// Example usage:
var logLines = [
    '2024-06-01T12:34:56.789Z INFO GET /api/users 200 123ms - User list retrieved successfully',
    '2024-06-01T12:35:00.123Z ERROR POST /api/login 500 50ms - Database connection failed',
    '2024-06-01T12:35:05.456Z WARN GET /api/products 404 30ms - Product not found',
    'Malformed log line example'
];
var parseResult = parseLines(logLines);
console.log('Parsed Entries:', parseResult.entries);
console.log('Malformed Lines:', parseResult.malformed);
console.log('Skipped Lines:', parseResult.skipped);
var stats = aggregateStats(parseResult.entries);
console.log('Endpoint Stats:', stats);
