const GITHUB_OWNER = 'NickGardner0';
const GITHUB_REPO = 'ritual-desktop-releases';

const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const GITHUB_LATEST_RELEASE_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubLatestRelease = {
  html_url?: string;
  assets?: GitHubReleaseAsset[];
};

function getGitHubHeaders() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ritual-download-route',
  };

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function resolveLatestMacDownloadUrl(): Promise<string> {
  let response: Response;

  try {
    response = await fetch(GITHUB_LATEST_RELEASE_API, {
      headers: getGitHubHeaders(),
      next: { revalidate: 300 },
    });
  } catch {
    return GITHUB_LATEST_RELEASE_PAGE;
  }

  if (!response.ok) {
    return GITHUB_LATEST_RELEASE_PAGE;
  }

  const release = (await response.json()) as GitHubLatestRelease;
  const assets = Array.isArray(release.assets) ? release.assets : [];

  const dmg = assets.find(
    (asset) =>
      typeof asset?.name === 'string' &&
      asset.name.toLowerCase().endsWith('.dmg') &&
      typeof asset.browser_download_url === 'string',
  );
  if (dmg?.browser_download_url) {
    return dmg.browser_download_url;
  }

  const zip = assets.find(
    (asset) =>
      asset?.name === 'Ritual.app.zip' &&
      typeof asset.browser_download_url === 'string',
  );
  if (zip?.browser_download_url) {
    return zip.browser_download_url;
  }

  return release.html_url || GITHUB_LATEST_RELEASE_PAGE;
}
