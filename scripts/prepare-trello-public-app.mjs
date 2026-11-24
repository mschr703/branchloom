import { existsSync, writeFileSync } from 'node:fs';

// A Trello API key identifies the app; user tokens remain private. The owner
// supplies this public app key at package time, never through a Git commit.
const key = process.env.BRANCHLOOM_TRELLO_PUBLIC_KEY;
if (key === undefined || key === '') {
  if (existsSync('trello-public-app.json')) {
    throw new Error('A Trello app key file exists without BRANCHLOOM_TRELLO_PUBLIC_KEY. Set the build variable or remove the stale file.');
  }
  console.log('Trello account sign-in not bundled (no public app key configured).');
} else if (!/^[a-z0-9]{16,128}$/i.test(key)) {
  throw new Error('BRANCHLOOM_TRELLO_PUBLIC_KEY has an invalid format.');
} else {
  writeFileSync('trello-public-app.json', JSON.stringify({ key }) + '\n', { mode: 0o600 });
  console.log('Trello public app key prepared outside Git.');
}
