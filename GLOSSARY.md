# Rouvy MCP

An unofficial MCP server that reads a rider's own Rouvy rides and serves them to MCP clients.

## Language

### Rides

**Activity**:
One completed ride on Rouvy, as Rouvy itself names it.
_Avoid_: Session, ride, workout

**Activity file**:
Rouvy's raw per-second recording of one Activity, the file behind Rouvy's "Export" button.
_Avoid_: Export, ride file

### Rider

**Rider settings**:
The rider's FTP, weight, max heart rate, and power and heart-rate zones.
_Avoid_: Profile, user settings, thresholds

**Activity snapshot**:
The copy of the Rider settings that Rouvy stored with one Activity, as they were when it was ridden.
_Avoid_: Ride-time settings, historical settings

### Access

**Session**:
A logged-in connection to Rouvy on the rider's behalf. Never a ride.
_Avoid_: Login (for the connection itself)

**Grant**:
A rider's permission for one MCP client to use a hosted rouvy-mcp server on their behalf, created when they sign in and ended by revocation or disuse.
_Avoid_: Session, connection, login, authorization

### Hosting

**Public instance**:
The hosted rouvy-mcp server the maintainer runs for invited riders, as opposed to one a rider hosts for themselves.
_Avoid_: The service, SaaS
