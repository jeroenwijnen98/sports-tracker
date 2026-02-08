on run
	-- Get project directory (parent of the .app bundle)
	set projectDir to do shell script "dirname " & quoted form of POSIX path of (path to me)

	-- Find node
	set nodePath to ""
	try
		set nodePath to do shell script "which node 2>/dev/null || echo ''"
	end try
	if nodePath is "" then
		try
			set nodePath to do shell script "test -x /opt/homebrew/bin/node && echo /opt/homebrew/bin/node || echo ''"
		end try
	end if
	if nodePath is "" then
		try
			set nodePath to do shell script "test -x /usr/local/bin/node && echo /usr/local/bin/node || echo ''"
		end try
	end if

	if nodePath is "" then
		display alert "Node.js not found" message "Install it with: brew install node"
		return
	end if

	-- Check if server is already running
	set alreadyRunning to false
	try
		do shell script "lsof -ti:3000 > /dev/null 2>&1"
		set alreadyRunning to true
	end try

	if not alreadyRunning then
		-- Start server in background
		do shell script "cd " & quoted form of projectDir & " && " & quoted form of nodePath & " server.js > /dev/null 2>&1 &"

		-- Wait for server to be ready
		repeat 20 times
			delay 0.5
			try
				do shell script "curl -s -o /dev/null http://localhost:3000"
				exit repeat
			end try
		end repeat
	end if

	-- Open browser
	do shell script "open http://localhost:3000"
end run
