export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';
let jsonMode = true;
let currentRunId = '';

export function configureLogger(level: LogLevel, json: boolean, runId: string) {
  currentLevel = level;
  jsonMode = json;
  currentRunId = runId;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  if (jsonMode) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      run_id: currentRunId,
      msg: message,
      ...fields,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
    const extra = fields ? ' ' + JSON.stringify(fields) : '';
    process.stdout.write(`${prefix} ${message}${extra}\n`);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
