import { describe, expectTypeOf, test } from 'vitest';
import { credential } from '#src/core/compile/credential';
import { CredentialKey } from '#src/core/compile/credential.model';

// What a generated credentials/<target>.ts file declares, for two targets. Its declaration merges for every source
// file, so the tests of credential() use these keys.
type DevList = readonly [
  { readonly key: 'gmail-sales'; readonly name: 'Gmail sales'; readonly type: 'gmailOAuth2'; readonly id: '1' },
  { readonly key: 'slack'; readonly name: 'Slack'; readonly type: 'slackApi'; readonly id: '2' },
];
type ProdList = readonly [{ readonly key: 'stripe'; readonly name: 'Stripe'; readonly type: 'stripeApi'; readonly id: '9' }];

declare module '#src/core/compile/credential.model' {
  interface CredentialLists {
    dev: DevList;
    prod: ProdList;
  }
}

describe('credential', () => {
  test('Should take the keys of every target when lists declare them', () => {
    expectTypeOf<CredentialKey>().toEqualTypeOf<'gmail-sales' | 'slack' | 'stripe'>();
  });

  test('Should type the entry with the type of its key when the key is listed', () => {
    expectTypeOf(credential('stripe')).toEqualTypeOf<{ stripeApi: { readonly boilerlift: 'credential'; readonly key: 'stripe' } }>();
  });

  test('Should reject a key when no list holds it', () => {
    // @ts-expect-error -- no list holds 'unknown-key'.
    expectTypeOf(credential('unknown-key')).toBeObject();
  });
});
