/**
 * Type declarations for logic-solver npm package
 *
 * This package provides MiniSat compiled to JavaScript via Emscripten.
 */

declare module "logic-solver" {
  namespace Logic {
    const TRUE: string;
    const FALSE: string;

    function isTerm(value: unknown): boolean;
    function isNameTerm(value: unknown): boolean;
    function isNumTerm(value: unknown): boolean;
    function isFormula(value: unknown): boolean;

    function not(operand: Term): string;
    function or(...operands: Term[]): Formula;
    function and(...operands: Term[]): Formula;
    function xor(...operands: Term[]): Formula;
    function implies(operand1: Term, operand2: Term): Formula;
    function equiv(operand1: Term, operand2: Term): Formula;
    function exactlyOne(...operands: Term[]): Formula;
    function atMostOne(...operands: Term[]): Formula;

    type Term = string | number | Formula;
    type Formula = object;

    class Solver {
      constructor();
      getVarNum(variableName: string, noCreate?: boolean): number;
      getVarName(variableNum: number): string;
      toNameTerm(term: Term): string;
      toNumTerm(term: Term, noCreate?: boolean): number;
      require(...args: Term[]): void;
      forbid(...args: Term[]): void;
      solve(): Solution | null;
      solveAssuming(assumption: Term): Solution | null;
    }

    class Solution {
      getMap(): Record<string, boolean>;
      getTrueVars(): string[];
      evaluate(expression: Term): boolean;
      getFormula(): Formula;
      getWeightedSum(formulas: Term[], weights: number[]): number;
      ignoreUnknownVariables(): this;
    }

    class Bits {
      constructor(formulas: Term[]);
    }

    function isBits(value: unknown): boolean;
    function constantBits(wholeNumber: number): Bits;
    function variableBits(baseName: string, N: number): Bits;
    function equalBits(bits1: Bits, bits2: Bits): Formula;
    function lessThan(bits1: Bits, bits2: Bits): Formula;
    function lessThanOrEqual(bits1: Bits, bits2: Bits): Formula;
    function greaterThan(bits1: Bits, bits2: Bits): Formula;
    function greaterThanOrEqual(bits1: Bits, bits2: Bits): Formula;
    function sum(...operands: (Term | Bits)[]): Bits;
    function weightedSum(formulas: Term[], weights: number[]): Bits;

    function disablingAssertions<T>(func: () => T): T;
  }

  export = Logic;
}
