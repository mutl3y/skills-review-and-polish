import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { StatusBarManager } from './statusBar';

vi.mock('vscode', () => {
  const createStatusBarItem = vi.fn(() => ({
    name: '',
    command: '',
    tooltip: '',
    text: '',
    show: vi.fn(),
    dispose: vi.fn(),
  }));

  return {
    StatusBarAlignment: { Left: 1 },
    window: { createStatusBarItem },
  };
});

describe('StatusBarManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows idle state on construction and updates through analysis states', () => {
    const manager = new StatusBarManager();
    const item = (vscode.window.createStatusBarItem as any).mock.results[0]?.value;

    expect(item).toBeDefined();
    expect(item.show).toHaveBeenCalledTimes(1);
    expect(item.text).toBe('$(beaker) Skills Review');

    manager.startAnalyzing();
    expect(item.text).toContain('Skills Review…');

    manager.showResult('A', 0);
    expect(item.text).toContain('No issues');
    expect(item.tooltip).toContain('grade A');

    manager.showError('model unavailable');
    expect(item.text).toBe('$(error) Skills Review');
    expect(item.tooltip).toContain('Error: model unavailable');

    manager.showIdle();
    expect(item.text).toBe('$(beaker) Skills Review');

    manager.dispose();
    expect(item.dispose).toHaveBeenCalledTimes(1);
  });
});
