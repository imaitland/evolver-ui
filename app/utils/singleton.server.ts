// Since the dev server re-requires the compiled bundle, do some shenanigans to make some things persist across that.
// Borrowed/modified from https://github.com/jenseng/abuse-the-platform/blob/2993a7e846c95ace693ce61626fa072174c8d9c7/app/utils/singleton.ts

export const singleton = <Value>(
  name: string,
  valueFactory: () => Value, // A function that returns a new class / object / whatever that you want to persist (in the global context) between server restarts.
): Value => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = global as any;
  g.__singletons ??= {};
  g.__singletons[name] ??= valueFactory();
  return g.__singletons[name];
};
