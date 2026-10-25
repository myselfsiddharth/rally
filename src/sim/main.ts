import { runCli } from './cli';

const { code, out } = runCli(process.argv.slice(2));
process.stdout.write(`${out}\n`);
process.exit(code);
