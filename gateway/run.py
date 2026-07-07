# Copyright 2017-present, The Visdom Authors
import os
import uvicorn

if __name__ == '__main__':
    port = int(os.getenv("PORT", 8082))
    uvicorn.run('app.main:app', host='0.0.0.0', port=port, reload=True)
