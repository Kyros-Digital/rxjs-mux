# rxjs-mux
## a observable/subject multiplexer
Mux is a simple multiplexer that buffers multiple emissions and only allows the last one to be passed on to a worker function.
allows discrimination of operations by key.
It is useful for situations where you want to quickly dispatch updates to a backend and ensure that only the last operation is executed/retried.

## References
- https://cameronnokes.com/blog/the-30-second-guide-to-publishing-a-typescript-package-to-npm/
- https://blog.jim-nielsen.com/2018/installing-and-building-an-npm-package-from-github/

- `npx typescript-starter`
