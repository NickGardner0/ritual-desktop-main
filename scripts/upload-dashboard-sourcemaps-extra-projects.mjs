#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const dashboardNextDir = path.join(repoRoot, 'apps', 'dashboard', '.next');
const sentryCli = path.join(repoRoot, 'node_modules', '.bin', 'sentry-cli');

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const org = process.env.SENTRY_ORG || 'nick-gardner';
const primaryProject = process.env.SENTRY_SOURCEMAP_PROJECT || process.env.SENTRY_PROJECT || 'javascript-nextjs';
const additionalProjects = splitList(process.env.SENTRY_ADDITIONAL_SOURCEMAP_PROJECTS)
  .filter((project) => project !== primaryProject);

if (additionalProjects.length === 0) {
  console.log('Sentry extra sourcemap upload skipped: SENTRY_ADDITIONAL_SOURCEMAP_PROJECTS is not set.');
  process.exit(0);
}

if (!process.env.SENTRY_AUTH_TOKEN) {
  console.error('SENTRY_ADDITIONAL_SOURCEMAP_PROJECTS is set, but SENTRY_AUTH_TOKEN is missing.');
  process.exit(1);
}

if (!existsSync(sentryCli)) {
  console.error(`sentry-cli was not found at ${sentryCli}`);
  process.exit(1);
}

if (!existsSync(dashboardNextDir)) {
  console.error(`Next.js build output was not found at ${dashboardNextDir}`);
  process.exit(1);
}

const uploadPaths = [
  path.join(dashboardNextDir, 'static'),
  path.join(dashboardNextDir, 'server'),
].filter((uploadPath) => existsSync(uploadPath));

if (uploadPaths.length === 0) {
  console.error('No dashboard sourcemap upload paths were found under apps/dashboard/.next.');
  process.exit(1);
}

const release =
  process.env.SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  '';

for (const project of additionalProjects) {
  const args = [
    'sourcemaps',
    'upload',
    '--org',
    org,
    '--project',
    project,
    '--validate',
    '--wait-for',
    '30',
    '--ignore',
    'node_modules',
    '--ignore',
    '.next/cache',
  ];

  if (release) {
    args.push('--release', release);
  }

  args.push(...uploadPaths);

  console.log(`Uploading dashboard sourcemaps to Sentry project "${project}"...`);
  const result = spawnSync(sentryCli, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
