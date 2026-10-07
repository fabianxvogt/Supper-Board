import type { FullConfig, Reporter, Suite } from '@playwright/test/reporter';

export default class RequiredWorkflowsReporter implements Reporter {
  private suite?: Suite;

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
  }

  async onEnd(): Promise<{ status: 'failed' } | undefined> {
    const tests = this.suite?.allTests() ?? [];
    const unexecuted = tests.filter((test) => test.expectedStatus === 'skipped'
      || test.results.length === 0 || test.results.some((result) => result.status === 'skipped'));
    if (!tests.length || unexecuted.length) {
      console.error('Required browser workflows did not execute:', unexecuted.map((test) => test.title).join('; ') || 'no tests selected');
      return { status: 'failed' };
    }
  }
}
