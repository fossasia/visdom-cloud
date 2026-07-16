# Copyright 2017-present, The Visdom Authors
import uvicorn

from app.config import settings

if __name__ == '__main__':
    uvicorn.run('app.main:app', host='0.0.0.0', port=settings.PORT, reload=True)
