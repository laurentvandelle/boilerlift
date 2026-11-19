import { err, ok } from '#src/core/common/result';
import { CredentialsWriter } from '#src/core/credentials/credentials.model';

export interface FakeCredentialsWriter {
  /** Saves to memory, or fails every time with `failWith`. */
  write: CredentialsWriter;
  /** The text last written at `path`, or `undefined` when nothing was. */
  text(path: string): string | undefined;
  /** The paths of every write, in order. */
  writes: string[];
}

export function fakeCredentialsWriter({ failWith }: { failWith?: string } = {}): FakeCredentialsWriter {
  const texts = new Map<string, string>();
  const writes: string[] = [];
  return {
    write: (path, text): ReturnType<CredentialsWriter> => {
      writes.push(path);
      if (failWith !== undefined) {
        return Promise.resolve(err({ reason: failWith }));
      }
      texts.set(path, text);
      return Promise.resolve(ok(undefined));
    },
    text: (path) => texts.get(path),
    writes,
  };
}
