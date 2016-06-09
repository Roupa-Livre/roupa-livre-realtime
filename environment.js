module.exports = {
    tokens: [],
    tokensHash: [],
    usersHash: [],
    loadSocketIo: function loadSocketIo(redis) {
        var current_module = this;
        var express = require('express');
        var socketIO = require('socket.io');
        var path = require('path');

        var port = process.env.PORT || 5001;
        if (process.env.NODE_ENV != 'production') {
            port = 5001; // run on a different port when in non-production mode.
        }

        var server = express()
          .use(function(req, res){ res.sendFile(INDEX) })
          .listen(port, function() {console.log('Listening on: ' + port)});

        var io = socketIO(server);

        io.on('connection', function(socket) {
            console.log('connection');

            socket.on('disconnect',function(){
                redis.sub.removeListener('message', onMessage); 
            });

            redis.sub.on('message', onMessage);

            function onMessage(channel, message){
                console.log(channel);
                console.log(message);
                // can't deliver a message to a socket with no handshake(session) established
                if (socket.request === undefined) {
                    return;
                }

                var messageData = JSON.parse(message);
                if (messageData.hasOwnProperty('type') && messageData.type == 'message') {
                    console.log('reading message');
                    var msg = messageData.data;
                    var chat_id = msg.chat.id;
                    msg.chat_id = chat_id;

                    var channel_name_1 = 'user:' + msg.chat.user_1_id + ':chat:' + chat_id + ':messages';
                    var channel_name_2 =  'user:' + msg.chat.user_2_id + ':chat:' + chat_id + ':messages';

                    delete msg['chat'];
                    
                    console.log('sending message: ' + channel_name_1);
                    socket.emit(channel_name_1, msg);
                    console.log('sending message: ' + channel_name_2);
                    socket.emit(channel_name_2, msg);
                }
            };

        });

        return io;
    },

    authorize: function authorize(io, redis) {
        // caso a gente va fazer parse
        // var cookieParser = require('socket.io-cookie');
        var current_module = this;
        
        // io.use(cookieParser);
        io.use(function(socket, next) {
            var sessionId = null;
            var userId = null;

            var url = require('url');
            requestUrl = url.parse(socket.request.url);
            requestQuery = requestUrl.query;
            requestParams = requestQuery.split('&');
            params = {};
            for (i=0; i<=requestParams.length; i++){
                param = requestParams[i];
                if (param){
                    var p=param.split('=');
                    if (p.length != 2) { continue };
                    params[p[0]] = p[1];
                }
            }

            // autenticar sem REDIS
            if (socket.request.session == null) {
                // console.log(socket.request);
                var requestToken = params['access-token'];
                if (current_module.tokensHash.hasOwnProperty(requestToken)) {
                    next()
                }
                else {
                    console.log('Unauthorized JS user (session)');
                    next(new Error('Unauthorized JS user (session)'));
                }

            } else {
                next();
            }
        });
    },

    loadRedis: function loadRedis() {
        var current_module = this;
        var redis = require('redis');
        var url = require('url');
        
        var redisSub, redisPub, redisGetSet = null;
        
        var redisURL;
        if (process.env.REDISTOGO_URL == null)
            redisURL = url.parse("redis://127.0.0.1:6379/0");
        else    
            redisURL = url.parse(process.env.REDISTOGO_URL);
        
        // console.log(redisURL);
        redisSub = redis.createClient(redisURL.port, redisURL.hostname, {
            no_ready_check: true
        });
        redisPub = redis.createClient(redisURL.port, redisURL.hostname, {
            no_ready_check: true
        });
        redisGetSet = redis.createClient(redisURL.port, redisURL.hostname, {
            no_ready_check: true
        });
        if (redisURL.auth != null) {
            redisSub.auth(redisURL.auth.split(":")[1]);
            redisPub.auth(redisURL.auth.split(":")[1]);
            redisGetSet.auth(redisURL.auth.split(":")[1]);
        }
        // redisSub.on("subscribe", function (channel, count) {
        //     console.log("a nice channel - I am sending a message.");
        //     console.log("a nice channel - I am sending a second message.");
        //     console.log("a nice channel - I am sending my last message.");
        //     console.log(channel);
        // });

        redisSub.on("message", function (channel, message) {
            if (channel == 'refresh_token') {
                var data = JSON.parse(message);

                // removes old if exists
                var userKey = '' + data.user;
                if (current_module.usersHash.hasOwnProperty(userKey)) {
                    var currentToken = current_module.usersHash[userKey];
                    current_module.tokens.splice(currentToken.tokenIndex, 1);
                    
                    if (current_module.tokensHash.hasOwnProperty(currentToken.token))
                        delete current_module.tokensHash[currentToken.token];
                }

                current_module.tokens.push(data);
                data.tokenIndex = current_module.tokens.length;

                current_module.tokensHash[data.token] = data;
                current_module.usersHash[userKey] = data;
            }
        });

        redisSub.subscribe('realtime_msg');
        redisSub.subscribe('refresh_token');

        return {
            pub: redisPub,
            sub: redisSub,
            getSet: redisGetSet,
        };
    },
}
