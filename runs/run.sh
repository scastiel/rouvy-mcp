#!/bin/zsh
cd "$(dirname "$0")"
while IFS='|' read -r q text; do
  for v in A B C all; do
    if [[ $v == A || $v == B ]]; then tools=(--tools ""); allow="mcp__rouvy"; else tools=(--tools "Bash,Read"); allow="mcp__rouvy Bash Read"; fi
    claude -p "$text" --mcp-config mcp-$v.json --strict-mcp-config "${tools[@]}" --allowedTools ${=allow} \
      --model sonnet --max-turns 20 --max-budget-usd 1 --output-format stream-json --verbose > $q-$v.jsonl 2> $q-$v.err &
  done
done < questions.txt
wait
echo ALL DONE
