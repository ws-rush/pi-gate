# pi-gate
Conditional execution gates for Pi. Block or warn on dangerous tool calls.
## Install
```bash
pi install npm:@artale/pi-gate
```
## Default rules (block)
`rm -rf /`, `DROP TABLE`, `DROP DATABASE`, `format c:`, `mkfs`, fork bomb
## Default rules (warn)
`dd if=/dev`, `chmod -R 777`, `npm publish`, `git push --force`
## Commands
```
/gate list            — show rules
/gate add <pat> warn  — add warning rule
/gate add <pat> block — add blocking rule
/gate rm <id>         — remove rule
/gate log             — recent events
```
## License
MIT
