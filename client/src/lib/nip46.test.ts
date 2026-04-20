import { describe, it, expect } from 'vitest';
import { Nip46Client, verifySignerResponse } from './nip46';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';

describe('verifySignerResponse', () => {
  const signerSecret = generateSecretKey();
  const signerPubkey = getPublicKey(signerSecret);
  const attackerSecret = generateSecretKey();
  const template = {
    kind: 1,
    content: 'hello',
    tags: [['t', 'test']],
    created_at: 1_700_000_000,
  };

  it('accepts a signature from the expected pubkey that matches the template', () => {
    const signed = finalizeEvent(template, signerSecret);
    const resultJson = JSON.stringify(signed);
    const out = verifySignerResponse(resultJson, template, signerPubkey);
    expect(out.pubkey).toBe(signerPubkey);
    expect(out.content).toBe('hello');
  });

  it('rejects when the signer uses the wrong key', () => {
    const signed = finalizeEvent(template, attackerSecret);
    expect(() => verifySignerResponse(JSON.stringify(signed), template, signerPubkey))
      .toThrow(/pubkey does not match/);
  });

  it('rejects when the signer mutates content before signing', () => {
    const tampered = { ...template, content: 'tampered' };
    const signed = finalizeEvent(tampered, signerSecret);
    expect(() => verifySignerResponse(JSON.stringify(signed), template, signerPubkey))
      .toThrow(/does not match template/);
  });

  it('rejects when the signer changes the kind', () => {
    const tampered = { ...template, kind: 9999 };
    const signed = finalizeEvent(tampered, signerSecret);
    expect(() => verifySignerResponse(JSON.stringify(signed), template, signerPubkey))
      .toThrow(/does not match template/);
  });

  it('rejects when the signer changes tags', () => {
    const tampered = { ...template, tags: [['t', 'evil']] };
    const signed = finalizeEvent(tampered, signerSecret);
    expect(() => verifySignerResponse(JSON.stringify(signed), template, signerPubkey))
      .toThrow(/does not match template/);
  });

  it('rejects malformed JSON', () => {
    expect(() => verifySignerResponse('not-json', template, signerPubkey))
      .toThrow(/malformed JSON/);
  });

  it('rejects null', () => {
    expect(() => verifySignerResponse('null', template, signerPubkey))
      .toThrow(/non-object/);
  });

  it('rejects a tampered signature', () => {
    const signed = finalizeEvent(template, signerSecret);
    const tampered = { ...signed, sig: signed.sig.replace(/.$/, '0') };
    expect(() => verifySignerResponse(JSON.stringify(tampered), template, signerPubkey))
      .toThrow(/signature is invalid/);
  });
});

describe('Nip46Client pairing binding', () => {
  function buildConnectEvent(opts: {
    senderSecret: Uint8Array;
    claimedPubkey: string;
    sessionPubkey: string;
  }) {
    const conversationKey = nip44.v2.utils.getConversationKey(
      opts.senderSecret,
      opts.sessionPubkey,
    );
    const encrypted = nip44.v2.encrypt(
      JSON.stringify({ result: opts.claimedPubkey }),
      conversationKey,
    );
    return finalizeEvent(
      {
        kind: 24133,
        content: encrypted,
        tags: [['p', opts.sessionPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      },
      opts.senderSecret,
    );
  }

  it('rejects a connect reply where result pubkey does not match the event sender', async () => {
    const client = new Nip46Client();
    const sessionPubkey = client['state'].sessionPubkey;

    const attackerSecret = generateSecretKey();
    const victimPubkey = getPublicKey(generateSecretKey());

    const forged = buildConnectEvent({
      senderSecret: attackerSecret,
      claimedPubkey: victimPubkey,
      sessionPubkey,
    });
    await client['handleIncoming'](forged);
    expect(client.remotePubkey).toBeNull();
  });

  it('binds remotePubkey only when result matches the event sender', async () => {
    const client = new Nip46Client();
    const sessionPubkey = client['state'].sessionPubkey;

    const signerSecret = generateSecretKey();
    const signerPubkey = getPublicKey(signerSecret);
    const legit = buildConnectEvent({
      senderSecret: signerSecret,
      claimedPubkey: signerPubkey,
      sessionPubkey,
    });
    await client['handleIncoming'](legit);
    expect(client.remotePubkey).toBe(signerPubkey);
  });
});
