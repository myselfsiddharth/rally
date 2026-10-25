/** Where "Add to Discord" goes. Send Messages is the only permission Rally asks for. */
export function inviteUrl(appId: string): string {
  const q = new URLSearchParams({ client_id: appId, scope: 'bot applications.commands', permissions: '2048' });
  return `https://discord.com/oauth2/authorize?${q}`;
}
