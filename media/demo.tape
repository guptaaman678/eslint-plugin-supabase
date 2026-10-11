# Records media/demo.gif for the README. Run from the repository root after `npm run build`:
#   vhs media/demo.tape
Output media/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1180
Set Height 700
Set Padding 24
Set TypingSpeed 40ms
Set Theme "GitHub Dark"

Hide
Type "cd media/demo && export PS1='$ ' && clear"
Enter
Sleep 500ms
Show

Type "cat src/chat.ts"
Sleep 300ms
Enter
Sleep 2s
Type "node check.mjs"
Sleep 300ms
Enter
Sleep 6s
