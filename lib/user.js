var dns = require('dns'),
    irc = require('./protocol');

function User(stream, ircServer) {
  this.server = ircServer;
  this.config = ircServer.config;
  this.nick = null;
  this.username = null;
  this.realname = null;
  this.channels = [];
  this.quitMessage = 'Connection lost';

  if (stream) {
    this.stream = stream;
    this.remoteAddress = stream.remoteAddress;
    this.hostname = stream.remoteAddress;
  }

  this.registered = false;
  this._modes = [];
  this.channelModes = {};
  this.serverName = '';
  this.created = new Date() / 1000;
  this.updated = new Date();
  this.isAway = false;
  this.awayMessage = null;
  this.serverOper = false;
  this.localOper = false;
  this.hopCount = 0;
  this.servertoken = null;

  this.hostLookup();
}

User.prototype = {
  get id() {
    return this.nick;
  },

  get mask() {
    return ':' + this.nick + '!' + this.username + '@' + this.hostname;
  },

  get modes() {
    return '+' + this._modes.join(''); 
  },

  set modes(modes) {
    if (modes) {
      modes = modes.replace(/^\+/, '');
      this._modes = modes.split('');
    }
  },

  get idle() {
    return parseInt(((new Date()) - this.updated) / 1000, 10);
  },

  get isOper() {
    return this.modes.indexOf('o') !== -1;
  },

  get isInvisible() {
    return this.modes.indexOf('i') !== -1;
  },

  send: function() {
    if (!this.stream) return;

    var message = arguments.length === 1 ?
        arguments[0]
      : Array.prototype.slice.call(arguments).join(' ');

    this.server.log('S: [' + this.nick + '] ' + message);
    try {
      this.stream.write(message + '\r\n');
    } catch (exception) {
      this.server.log(exception);
    }
  },

  expandMask: function(mask) {
    return mask.replace(/\./g, '\\.').
                replace(/\*/g, '.*');
  },

  matchesMask: function(mask) {
    var parts = mask.match(/([^!]*)!([^@]*)@(.*)/) || [],
        matched = true,
        lastPart = parts.length < 4 ? parts.length : 4;
    parts = parts.slice(1, lastPart).map(this.expandMask);

    if (!this.nick.match(parts[0])) {
      return false;
    } else if (!this.username.match(parts[1])) {
      return false;
    } else if (!this.hostname.match(parts[2])) {
      return false;
    } else {
      return true;
    }
  },

  sharedChannelWith: function(targetUser) {
    var user = this,
        channels = targetUser.channels,
        matchedChannel;
    channels.some(function(channel) {
      if (user.channels.indexOf(channel) !== -1) {
        matchedChannel = channel;
        return true;
      }
    });

    return matchedChannel;
  },

  // TODO: Voice
  channelNick: function(channel) {
    return this.isOp(channel) ? '@' + this.nick : this.nick;
  },

  isOp: function(channel) {
    if (this.channelModes[channel])
      return this.channelModes[channel].match(/o/);
  },

  op: function(channel) {
    this.channelModes[channel] += 'o';
  },

  deop: function(channel) {
    if (this.channelModes[channel])
      this.channelModes[channel] = this.channelModes[channel].replace(/o/, '');
  },

  oper: function() {
    if (!this.modes.match(/o/)) {
      this._modes.push('o');
      this.send(this.mask, 'MODE', this.nick, '+o', this.nick);
    }
  },

  deoper: function() {
    this.removeMode.o.apply(this);
  },

  isVoiced: function(channel) {
    if (this.channelModes[channel])
      return this.channelModes[channel].match(/v/) || this.isOp(channel);
  },

  voice: function(channel) {
    this.channelModes[channel] += 'v';
  },

  devoice: function(channel) {
    if (this.channelModes[channel])
      this.channelModes[channel] = this.channelModes[channel].replace(/v/, '');
  },

  hostLookup: function() {
    if (!this.remoteAddress) return;
    user = this;
    dns.reverse(this.remoteAddress, function(err, addresses) {
      user.hostname = addresses && addresses.length > 0 ? addresses[0] : user.remoteAddress;
    });
  },

  register: function() {
    if (this.registered === false
        && this.nick
        && this.username) {
      this.serverName = this.config.name;
      this.send(this.server.host, irc.reply.welcome, this.nick, 'Welcome to the ' + this.config.network + ' IRC network', this.mask);
      this.send(this.server.host, irc.reply.yourHost, this.nick, 'Your host is', this.config.hostname, 'running version', this.server.version);
      this.send(this.server.host, irc.reply.created, this.nick, 'This server was created on', this.server.created);
      this.send(this.server.host, irc.reply.myInfo, this.nick, this.config.name, this.server.version);
      this.server.motd(this);
      this.registered = true;
      this.addMode.w.apply(this);
    }
  },

  message: function(nick, message) {
    var user = this.server.users.find(nick);
    this.updated = new Date();

    if (user) {
      if (user.isAway) {
        this.send(this.server.host, irc.reply.away, this.nick, user.nick, ':' + user.awayMessage);          
      }
      user.send(this.mask, 'PRIVMSG', user.nick, ':' + message);
    } else {
      this.send(this.server.host, irc.errors.noSuchNick, this.nick, nick, ':No such nick/channel');
    }
  },

  addModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.addMode[mode])
        thisUser.addMode[mode].apply(thisUser, [user, arg]);
    });
  },

  addMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (!user.modes.match(/i/)) {
          user._modes.push('i');
          user.send(user.mask, 'MODE', this.nick, '+i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '+i', user.nick);
          }
        }
      } else {
        this.send(this.server.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ":Cannot change mode for other users");
      }
    },

    o: function() {
      // Can only be issued by OPER
    },

    w: function() {
      if (!this.modes.match(/w/)) {
        this._modes.push('w');
        this.send(this.mask, 'MODE', this.nick, '+w', this.nick);
      }
    }
  },

  removeModes: function(user, modes, arg) {
    var thisUser = this;
    modes.slice(1).split('').forEach(function(mode) {
      if (thisUser.removeMode[mode])
        thisUser.removeMode[mode].apply(thisUser, [user, arg]);
    });
  },

  removeMode: {
    i: function(user, arg) {
      if (this.isOper || this === user) {
        if (user.modes.match(/i/)) {
          user._modes.splice(user._modes.indexOf('i'), 1);
          user.send(user.mask, 'MODE', this.nick, '-i', user.nick);
          if (this !== user) {
            this.send(this.mask, 'MODE', this.nick, '-i', user.nick);
          }
        }
      } else {
        this.send(this.server.host, irc.errors.usersDoNotMatch, this.nick, user.nick, ":Cannot change mode for other users");
      }
    },

    o: function() {
      if (this.modes.match(/o/)) {
        user._modes.splice(user._modes.indexOf('o'), 1);
        this.send(this.mask, 'MODE', this.nick, '-o', this.nick);
      }
    },

    w: function() {
      if (this.modes.match(/w/)) {
        user._modes.splice(user._modes.indexOf('w'), 1);
        this.send(this.mask, 'MODE', this.nick, '-w', this.nick);
      }
    }
  },

  quit: function(message) {
    this.quitMessage = message;
    this.stream.end();
  }
};

exports.User = User;
